#!/usr/bin/env bash
# smoke-test-e2e.sh — End-to-end smoke test: ACA agent job with KV-injected
# secrets spawns → agent-entrypoint.sh runs → gsd headless starts.
#
# Usage:
#   bash scripts/smoke-test-e2e.sh [options]
#
# Options:
#   --dry-run                  Validate prerequisites only; do not create Azure resources.
#   --skip-build               Skip 'az acr build'; use the existing image in ACR.
#   --subscription <id>        Override the active az subscription.
#   --job-name <name>          Override the test job name (default: optio-e2e-smoke-job).
#
# Prerequisites:
#   - az CLI authenticated (az login or Managed Identity)
#   - Correct subscription set (or pass --subscription <id>)
#   - Contributor on rg-avd-dev-eastus
#   - Key Vault secrets accessible from id-ppf-aca-dev-eastus
#
# Exit codes:
#   0  all assertions pass (or --dry-run prerequisites pass)
#   1  one or more assertions failed or prerequisites not met

set -uo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

RG="${ACA_RESOURCE_GROUP:-rg-avd-dev-eastus}"
CAE="${ACA_ENVIRONMENT:-cae-dev-eastus}"
LOCATION="${ACA_LOCATION:-eastus}"
ACR="${ACA_REGISTRY:-acrdevd2thdvq46mgnw.azurecr.io}"
ACR_NAME="${ACR%%.*}"
AGENT_IMAGE="${AGENT_IMAGE:-${ACR}/gsd-agent:m001}"
IDENTITY_NAME="id-ppf-aca-dev-eastus"
KV_NAME="kv-ppf-dev-eastus"
TEMPLATE_FILE="scripts/aca-job-template.json"
PREFLIGHT_SCRIPT="scripts/preflight-secrets.sh"

JOB_NAME="optio-e2e-smoke-job"
DRY_RUN=false
SKIP_BUILD=false
SUBSCRIPTION_OVERRIDE=""

POLL_INTERVAL_SEC=10
POLL_MAX_SEC=300
LOG_TIMEOUT_SEC=60

# ── Argument parsing ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)          DRY_RUN=true ;;
    --skip-build)       SKIP_BUILD=true ;;
    --subscription)     SUBSCRIPTION_OVERRIDE="$2"; shift ;;
    --job-name)         JOB_NAME="$2"; shift ;;
    *)                  echo "[WARN] Unknown argument: $1" ;;
  esac
  shift
done

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ── Counters ──────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
WARN=0

# ── Helpers ───────────────────────────────────────────────────────────────────

green()  { printf '\033[0;32m[PASS]\033[0m %s\n' "$1"; (( PASS++ )) || true; }
red()    { printf '\033[0;31m[FAIL]\033[0m %s\n' "$1"; (( FAIL++ )) || true; }
warn()   { printf '\033[0;33m[WARN]\033[0m %s\n' "$1"; (( WARN++ )) || true; }
info()   { printf '\033[0;36m[INFO]\033[0m %s\n' "$1"; }
section(){ echo; echo "────────────────────────────────────────────────────────"; echo "$1"; echo "────────────────────────────────────────────────────────"; }

# ── Cleanup trap ──────────────────────────────────────────────────────────────

CLEANUP_DONE=false

cleanup() {
  if $CLEANUP_DONE; then return; fi
  CLEANUP_DONE=true
  section "Cleanup"
  if $DRY_RUN; then
    info "[dry-run] Would delete test job '$JOB_NAME' if it exists"
    return
  fi
  info "Deleting test job '$JOB_NAME' if it exists ..."
  if az containerapp job show -n "$JOB_NAME" -g "$RG" --output none 2>/dev/null; then
    if az containerapp job delete -n "$JOB_NAME" -g "$RG" --yes --output none 2>&1; then
      info "Test job '$JOB_NAME' deleted."
    else
      warn "Failed to delete test job '$JOB_NAME' — manual cleanup may be required."
    fi
  else
    info "Test job '$JOB_NAME' not found — nothing to clean up."
  fi
}

trap cleanup EXIT

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Optio E2E Smoke Test — ACA Agent Job + KV Secrets  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Job name  : $JOB_NAME"
echo "  Dry-run   : $DRY_RUN"
echo "  Skip-build: $SKIP_BUILD"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1 — Prerequisites
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 1 — Prerequisites"

# P1: az CLI available
if ! command -v az &>/dev/null; then
  red "az CLI not found in PATH — cannot continue"
  echo ""
  echo "RESULT: 0 pass, 1 fail, $WARN warn"
  exit 1
fi
green "az CLI available"

# P2: Subscription override
if [[ -n "$SUBSCRIPTION_OVERRIDE" ]]; then
  if $DRY_RUN; then
    info "[dry-run] Would run: az account set --subscription $SUBSCRIPTION_OVERRIDE"
  else
    info "Setting subscription: $SUBSCRIPTION_OVERRIDE"
    if ! az account set --subscription "$SUBSCRIPTION_OVERRIDE" 2>&1; then
      red "Failed to set subscription '$SUBSCRIPTION_OVERRIDE'"
      exit 1
    fi
  fi
  green "Subscription override applied: $SUBSCRIPTION_OVERRIDE"
fi

# P3: az auth
if $DRY_RUN; then
  info "[dry-run] Skipping live az account check"
else
  ACCOUNT_JSON=""
  if ! ACCOUNT_JSON=$(az account show --output json 2>&1); then
    red "az account show failed — not authenticated? Output: $ACCOUNT_JSON"
    exit 1
  fi
  SUB_ID=$(node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.id)" <<< "$ACCOUNT_JSON" 2>/dev/null || \
           echo "$ACCOUNT_JSON" | grep '"id"' | head -1 | sed 's/.*"id": *"\([^"]*\)".*/\1/')
  SUB_NAME=$(node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.name||'unknown')" <<< "$ACCOUNT_JSON" 2>/dev/null || echo "unknown")
  if [[ -z "$SUB_ID" ]]; then
    red "Could not parse subscription ID from az account show"
    exit 1
  fi
  green "Authenticated — subscription: $SUB_NAME ($SUB_ID)"
fi

# P4: Resource group exists
if $DRY_RUN; then
  info "[dry-run] Would check: az group show -n $RG"
else
  if ! az group show -n "$RG" --output none 2>/dev/null; then
    red "Resource group '$RG' not found"
    exit 1
  fi
  green "Resource group '$RG' found"
fi

# P5: Container Apps Environment exists
if $DRY_RUN; then
  info "[dry-run] Would check: az containerapp env show -n $CAE -g $RG"
else
  if ! az containerapp env show -n "$CAE" -g "$RG" --output none 2>/dev/null; then
    red "Container Apps Environment '$CAE' not found in '$RG'"
    exit 1
  fi
  green "Container Apps Environment '$CAE' found"
fi

# P6: ACR exists
if $DRY_RUN; then
  info "[dry-run] Would check: az acr show -n $ACR_NAME"
else
  if ! az acr show -n "$ACR_NAME" --output none 2>/dev/null; then
    red "ACR '$ACR_NAME' not found"
    exit 1
  fi
  green "ACR '$ACR_NAME' found"
fi

# P7: Managed identity resolves
IDENTITY_RID=""
if $DRY_RUN; then
  info "[dry-run] Would resolve managed identity '$IDENTITY_NAME'"
else
  IDENTITY_RID=$(az identity show -n "$IDENTITY_NAME" -g "$RG" --query id --output tsv 2>/dev/null || true)
  if [[ -z "$IDENTITY_RID" ]]; then
    warn "Could not resolve managed identity '$IDENTITY_NAME' in '$RG' — will proceed without explicit identity"
  else
    green "Managed identity resolved: $IDENTITY_NAME"
  fi
fi

# P8: KV accessible — run preflight-secrets.sh
if [[ -f "$PREFLIGHT_SCRIPT" ]]; then
  info "Running preflight-secrets.sh ..."
  if $DRY_RUN; then
    if bash "$PREFLIGHT_SCRIPT" --dry-run; then
      green "preflight-secrets.sh passed (dry-run)"
    else
      red "preflight-secrets.sh reported failures in dry-run mode"
    fi
  else
    if bash "$PREFLIGHT_SCRIPT"; then
      green "preflight-secrets.sh: all KV secrets accessible"
    else
      red "preflight-secrets.sh: one or more KV secrets missing — fix before running live job"
      echo ""
      echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
      exit 1
    fi
  fi
else
  red "preflight script not found: $PREFLIGHT_SCRIPT"
  echo ""
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  exit 1
fi

# P9: Template file present
if [[ -f "$TEMPLATE_FILE" ]]; then
  # Verify JSON is parseable and has secrets
  SECRET_COUNT=$(node -e "
const t=JSON.parse(require('fs').readFileSync('${TEMPLATE_FILE}','utf8'));
const s=t.configuration && t.configuration.secrets ? t.configuration.secrets.length : 0;
process.stdout.write(String(s));
" 2>/dev/null || echo "0")
  if [[ "$SECRET_COUNT" -ge 2 ]]; then
    green "aca-job-template.json present and has $SECRET_COUNT KV secret(s)"
  else
    red "aca-job-template.json present but has < 2 secrets (found: $SECRET_COUNT)"
  fi
else
  red "Template file not found: $TEMPLATE_FILE"
fi

# ── Dry-run exit point ────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo " Dry-run complete — prerequisites evaluated, no Azure resources created."
  echo "════════════════════════════════════════════════════════"
  echo ""
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  if [[ $FAIL -gt 0 ]]; then
    exit 1
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2 — Image build (unless --skip-build)
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 2 — Image Build"

if $SKIP_BUILD; then
  info "Skipping image build (--skip-build flag set)"
  green "Image build skipped"
else
  info "Building agent image in ACR: $AGENT_IMAGE ..."
  if az acr build \
      --registry "$ACR_NAME" \
      --image "${AGENT_IMAGE##*/}" \
      --file Dockerfile.agent \
      . 2>&1; then
    green "az acr build succeeded: $AGENT_IMAGE"
  else
    red "az acr build failed"
    echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
    exit 1
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3 — Job creation from aca-job-template.json
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 3 — Create ACA Job with KV Secrets"

# Substitute __SUBSCRIPTION_ID__ in template and emit job creation args
info "Preparing job definition from template ..."

# Parse template to extract configuration fields via node
TEMPLATE_JSON=$(node -e "
const fs = require('fs');
const raw = fs.readFileSync('${TEMPLATE_FILE}', 'utf8');
const filled = raw.replace(/__SUBSCRIPTION_ID__/g, '${SUB_ID:-UNKNOWN}');
process.stdout.write(filled);
" 2>/dev/null)

if [[ -z "$TEMPLATE_JSON" ]]; then
  red "Failed to read/substitute template file"
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  exit 1
fi

# Extract environment ID and replica timeout
ENV_ID=$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(d.environmentId||'')" -- "$TEMPLATE_JSON" 2>/dev/null || true)
REPLICA_TIMEOUT=$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write(String(d.configuration.replicaTimeout||300))" -- "$TEMPLATE_JSON" 2>/dev/null || echo "300")

# Delete existing job if present (idempotent)
info "Checking if test job '$JOB_NAME' already exists ..."
if az containerapp job show -n "$JOB_NAME" -g "$RG" --output none 2>/dev/null; then
  warn "Job '$JOB_NAME' already exists — deleting for clean test run"
  az containerapp job delete -n "$JOB_NAME" -g "$RG" --yes --output none
  info "Existing job deleted. Waiting for propagation ..."
  sleep 5
fi

# Build create command using az containerapp job create with secrets from template
# We pipe the full ARM JSON through stdin is not supported; use CLI flags instead.
# Secrets referencing Key Vault must be passed as environment variables with secretRef.
info "Creating ACA Job '$JOB_NAME' with KV-referenced secrets ..."

CREATE_OUTPUT=""
CREATE_ARGS=(
  --name         "$JOB_NAME"
  --resource-group "$RG"
  --environment  "$CAE"
  --trigger-type Manual
  --replica-timeout "$REPLICA_TIMEOUT"
  --replica-retry-limit 0
  --cpu    0.5
  --memory 1Gi
  --image  "$AGENT_IMAGE"
  --registry-server "$ACR"
  --output json
)

# Attach managed identity
if [[ -n "$IDENTITY_RID" ]]; then
  CREATE_ARGS+=(--registry-identity "$IDENTITY_RID")
  CREATE_ARGS+=(--mi-user-assigned   "$IDENTITY_RID")
fi

# KV secrets — use az containerapp job create --secrets syntax:
#   name=keyvaultref:<url>,identityref:<identity-rid>
# Requires az CLI >= 2.56
KV_BASE="https://${KV_NAME}.vault.azure.net/secrets"
if [[ -n "$IDENTITY_RID" ]]; then
  CREATE_ARGS+=(
    --secrets
    "anthropic-api-key=keyvaultref:${KV_BASE}/anthropic-api-key,identityref:${IDENTITY_RID}"
    "github-token=keyvaultref:${KV_BASE}/GITHUB-TOKEN,identityref:${IDENTITY_RID}"
  )
fi

# Environment variables referencing secrets
CREATE_ARGS+=(
  --env-vars
  "ANTHROPIC_API_KEY=secretref:anthropic-api-key"
  "GITHUB_TOKEN=secretref:github-token"
  "REPO_URL=__REPO_URL__"
  "REPO_BRANCH=main"
  "GSD_TIMEOUT_MS=60000"
)

if ! CREATE_OUTPUT=$(az containerapp job create "${CREATE_ARGS[@]}" 2>&1); then
  red "az containerapp job create failed"
  echo "--- Error ---"
  echo "$CREATE_OUTPUT"
  echo "-------------"
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  exit 1
fi

green "ACA Job '$JOB_NAME' created with KV-referenced secrets"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4 — Start execution
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 4 — Start Execution"

info "Starting job execution ..."

EXECUTION_NAME=""
START_OUTPUT=""

if ! START_OUTPUT=$(az containerapp job start -n "$JOB_NAME" -g "$RG" --output json 2>&1); then
  red "az containerapp job start failed"
  echo "--- Error ---"
  echo "$START_OUTPUT"
  echo "-------------"
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  exit 1
fi

# Parse execution name from start output
EXECUTION_NAME=$(node -e "
const d=JSON.parse(process.argv[1]);
// 'name' field or last segment of 'id'
const n = d.name || (d.id ? d.id.split('/').pop() : '');
process.stdout.write(n);
" -- "$START_OUTPUT" 2>/dev/null || true)

if [[ -z "$EXECUTION_NAME" ]]; then
  warn "Could not parse execution name from start output — querying execution list"
  EXECUTION_NAME=$(az containerapp job execution list -n "$JOB_NAME" -g "$RG" \
    --query '[0].name' --output tsv 2>/dev/null || true)
fi

if [[ -z "$EXECUTION_NAME" ]]; then
  red "Could not determine execution name — cannot poll for status"
  echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
  exit 1
fi

green "Execution started: $EXECUTION_NAME"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 5 — Poll for completion
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 5 — Poll for Completion (max ${POLL_MAX_SEC}s, every ${POLL_INTERVAL_SEC}s)"

FINAL_STATUS=""
POLL_ELAPSED=0
POLL_PASS=false

info "Polling execution '$EXECUTION_NAME' ..."

while [[ "$POLL_ELAPSED" -lt "$POLL_MAX_SEC" ]]; do
  RETRY=0
  EXEC_OUTPUT=""
  STATUS=""

  while [[ "$RETRY" -lt 3 ]]; do
    if EXEC_OUTPUT=$(az containerapp job execution show \
        -n "$JOB_NAME" \
        -g "$RG" \
        --job-execution-name "$EXECUTION_NAME" \
        --output json 2>&1); then
      STATUS=$(node -e "
const d=JSON.parse(process.argv[1]);
const s = (d.properties && d.properties.status) || d.status || 'Unknown';
process.stdout.write(s);
" -- "$EXEC_OUTPUT" 2>/dev/null || echo "Unknown")
      break
    else
      (( RETRY++ )) || true
      warn "Execution show failed (attempt $RETRY/3): $(echo "$EXEC_OUTPUT" | head -1)"
      sleep 5
    fi
  done

  if [[ "$RETRY" -eq 3 ]]; then
    red "Execution show failed after 3 retries"
    FINAL_STATUS="FetchFailed"
    break
  fi

  info "  Status: $STATUS  (${POLL_ELAPSED}s elapsed)"

  case "$STATUS" in
    Succeeded|Failed|Stopped|Degraded)
      FINAL_STATUS="$STATUS"
      break
      ;;
    Running|Processing|Pending|"")
      ;;
    *)
      info "  (treating '$STATUS' as pending)"
      ;;
  esac

  sleep "$POLL_INTERVAL_SEC"
  (( POLL_ELAPSED += POLL_INTERVAL_SEC )) || true
done

if [[ "$POLL_ELAPSED" -ge "$POLL_MAX_SEC" && -z "$FINAL_STATUS" ]]; then
  red "Polling timed out after ${POLL_MAX_SEC}s — last status: $STATUS"
  FINAL_STATUS="Timeout"
fi

if [[ "$FINAL_STATUS" == "Succeeded" ]]; then
  green "Execution completed: Succeeded"
  POLL_PASS=true
else
  red "Execution did not succeed — final status: $FINAL_STATUS"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 6 — Log retrieval (Log Analytics)
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 6 — Log Retrieval ([entrypoint] signal)"

LOG_OUTPUT=""
LOG_PASS=false

# Get Log Analytics workspace ID from Container Apps Environment
LA_WORKSPACE=$(az containerapp env show -n "$CAE" -g "$RG" \
  --query 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId' \
  --output tsv 2>/dev/null || true)

if [[ -n "$LA_WORKSPACE" ]]; then
  info "Log Analytics workspace: $LA_WORKSPACE"
  info "Waiting for log ingestion (up to ${LOG_TIMEOUT_SEC}s) ..."

  LOG_QUERY="ContainerAppConsoleLogs_CL \
| where ContainerJobExecutionName_s == \"$EXECUTION_NAME\" \
| project TimeGenerated, Log_s \
| order by TimeGenerated asc"

  LOG_ELAPSED=0
  while [[ "$LOG_ELAPSED" -lt "$LOG_TIMEOUT_SEC" ]]; do
    LOG_OUTPUT=$(az monitor log-analytics query \
      -w "$LA_WORKSPACE" \
      --analytics-query "$LOG_QUERY" \
      --output json 2>/dev/null \
      | node -e "
const rows = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const lines = Array.isArray(rows) ? rows.map(r => r.Log_s || r.log_s || '').join('\n') : '';
process.stdout.write(lines);
" 2>/dev/null || true)

    if [[ -n "$LOG_OUTPUT" ]]; then
      info "Log output received after ${LOG_ELAPSED}s"
      break
    fi

    info "  Logs not yet available — waiting ${POLL_INTERVAL_SEC}s ..."
    sleep "$POLL_INTERVAL_SEC"
    (( LOG_ELAPSED += POLL_INTERVAL_SEC )) || true
  done
else
  warn "Log Analytics workspace not found on CAE '$CAE' — skipping log query"
fi

# Secondary: az containerapp logs show (Container Apps only, may not work for jobs)
if [[ -z "$LOG_OUTPUT" ]]; then
  info "Trying az containerapp logs show (fallback) ..."
  LOG_OUTPUT=$(timeout "$LOG_TIMEOUT_SEC" az containerapp logs show \
    --name "$JOB_NAME" --resource-group "$RG" --output text 2>/dev/null || true)
fi

# Report log results
if [[ -n "$LOG_OUTPUT" ]]; then
  info "--- LOG BEGIN ---"
  echo "$LOG_OUTPUT"
  info "--- LOG END ---"
  LOG_PASS=true
  green "Log output retrieved"
else
  warn "No log output retrieved within ${LOG_TIMEOUT_SEC}s — logs may be delayed (2–5 min in Log Analytics)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 7 — Assertions
# ═══════════════════════════════════════════════════════════════════════════

section "PHASE 7 — Assertions"

# A1: Execution status == Succeeded
if $POLL_PASS; then
  green "ASSERT: Execution status == Succeeded"
else
  red "ASSERT: Execution status != Succeeded (got: $FINAL_STATUS)"
fi

# A2: [entrypoint] log signal present
if [[ -n "$LOG_OUTPUT" ]]; then
  if echo "$LOG_OUTPUT" | grep -q '\[entrypoint\]'; then
    green "ASSERT: [entrypoint] log lines found — agent-entrypoint.sh ran inside ACA job"
  else
    red "ASSERT: No [entrypoint] log lines found — agent-entrypoint.sh may not have started"
    info "  Actual log snippet (first 10 lines):"
    echo "$LOG_OUTPUT" | head -10
  fi
else
  warn "ASSERT: [entrypoint] check skipped — no log output available (logs may still be ingesting)"
  info "  Execution status ($FINAL_STATUS) is the primary success signal."
fi

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════"
echo " E2E Smoke Test Summary"
echo "════════════════════════════════════════════════════════"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo "════════════════════════════════════════════════════════"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "RESULT: FAIL"
  exit 1
else
  echo "RESULT: PASS"
  exit 0
fi
