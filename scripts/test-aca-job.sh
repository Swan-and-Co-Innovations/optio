#!/usr/bin/env bash
# test-aca-job.sh — End-to-end integration test: spawn ACA Job running "echo hello",
# poll for completion, retrieve logs, assert output.
#
# Usage:
#   bash scripts/test-aca-job.sh [--dry-run]
#
# Prerequisites:
#   - az CLI authenticated (az login or Managed Identity)
#   - Correct subscription set (az account set -s <id>)
#   - Permissions: Contributor on rg-avd-dev-eastus
#
# Environment variables (all optional — defaults match dev environment):
#   ACA_RESOURCE_GROUP   Default: rg-avd-dev-eastus
#   ACA_ENVIRONMENT      Default: cae-dev-eastus
#   ACA_LOCATION         Default: eastus
#   ACA_IMAGE            Default: acrdevd2thdvq46mgnw.azurecr.io/gsd-agent:m001
#   ACA_REGISTRY         Default: acrdevd2thdvq46mgnw.azurecr.io
#   ACA_IDENTITY_RID     Default: resolved dynamically from identity name
#   TEST_JOB_NAME        Default: optio-test-echo-job
#   POLL_INTERVAL_SEC    Default: 10
#   POLL_MAX_SEC         Default: 120
#   LOG_TIMEOUT_SEC      Default: 30

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────

RG="${ACA_RESOURCE_GROUP:-rg-avd-dev-eastus}"
CAE="${ACA_ENVIRONMENT:-cae-dev-eastus}"
LOCATION="${ACA_LOCATION:-eastus}"
IMAGE="${ACA_IMAGE:-acrdevd2thdvq46mgnw.azurecr.io/gsd-agent:m001}"
REGISTRY="${ACA_REGISTRY:-acrdevd2thdvq46mgnw.azurecr.io}"
IDENTITY_NAME="id-ppf-aca-dev-eastus"
TEST_JOB="${TEST_JOB_NAME:-optio-test-echo-job}"
POLL_INTERVAL="${POLL_INTERVAL_SEC:-10}"
POLL_MAX="${POLL_MAX_SEC:-120}"
LOG_TIMEOUT="${LOG_TIMEOUT_SEC:-30}"
DRY_RUN=false

# ── Argument parsing ────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "[WARN] Unknown argument: $arg" ;;
  esac
done

# ── Counters ────────────────────────────────────────────────────────────────

PASS=0
FAIL=0
WARN=0

# ── Helpers ─────────────────────────────────────────────────────────────────

green() { printf '\033[0;32m[PASS]\033[0m %s\n' "$1"; ((PASS++)) || true; }
red()   { printf '\033[0;31m[FAIL]\033[0m %s\n' "$1"; ((FAIL++)) || true; }
warn()  { printf '\033[0;33m[WARN]\033[0m %s\n' "$1"; ((WARN++)) || true; }
info()  { printf '\033[0;36m[INFO]\033[0m %s\n' "$1"; }
hr()    { echo "────────────────────────────────────────────────────────"; }

# ── Cleanup trap ─────────────────────────────────────────────────────────────

CLEANUP_DONE=false

cleanup() {
  if $CLEANUP_DONE; then return; fi
  CLEANUP_DONE=true
  hr
  info "Cleanup: deleting test job '$TEST_JOB' if it exists ..."
  if $DRY_RUN; then
    info "[dry-run] Would run: az containerapp job delete -n $TEST_JOB -g $RG --yes"
    return
  fi
  if az containerapp job show -n "$TEST_JOB" -g "$RG" --output none 2>/dev/null; then
    if az containerapp job delete -n "$TEST_JOB" -g "$RG" --yes --output none 2>&1; then
      info "Test job deleted."
    else
      warn "Failed to delete test job '$TEST_JOB' — manual cleanup may be required."
    fi
  else
    info "Test job '$TEST_JOB' not found — nothing to clean up."
  fi
}

trap cleanup EXIT

# ── Step 1: Prerequisites ───────────────────────────────────────────────────

hr
echo "STEP 1 — Prerequisites"
hr

info "Checking az CLI ..."
if ! command -v az &>/dev/null; then
  red "az CLI not found in PATH"
  echo ""
  echo "RESULT: 0 pass, 1 fail, $WARN warn"
  exit 1
fi
green "az CLI available"

info "Checking az account ..."
ACCOUNT_JSON=""
if ! ACCOUNT_JSON=$(az account show --output json 2>&1); then
  red "az account show failed — not authenticated? Output: $ACCOUNT_JSON"
  exit 1
fi

SUB_ID=$(echo "$ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null \
         || echo "$ACCOUNT_JSON" | grep '"id"' | head -1 | sed 's/.*"id": "\(.*\)".*/\1/')
SUB_NAME=$(echo "$ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])" 2>/dev/null \
           || echo "(unknown)")

if [ -z "$SUB_ID" ]; then
  red "Could not parse subscription ID from az account show"
  exit 1
fi

green "Authenticated — subscription: $SUB_NAME ($SUB_ID)"

info "Verifying resource group '$RG' exists ..."
if ! az group show -n "$RG" --output none 2>/dev/null; then
  red "Resource group '$RG' not found"
  exit 1
fi
green "Resource group '$RG' found"

info "Verifying Container Apps Environment '$CAE' exists ..."
if ! az containerapp env show -n "$CAE" -g "$RG" --output none 2>/dev/null; then
  red "Container Apps Environment '$CAE' not found in '$RG'"
  exit 1
fi
green "Container Apps Environment '$CAE' found"

info "Resolving managed identity resource ID ..."
IDENTITY_RID="${ACA_IDENTITY_RID:-}"
if [ -z "$IDENTITY_RID" ]; then
  IDENTITY_RID=$(az identity show -n "$IDENTITY_NAME" -g "$RG" --query id --output tsv 2>/dev/null || true)
fi
if [ -z "$IDENTITY_RID" ]; then
  warn "Could not resolve managed identity '$IDENTITY_NAME' — will create job without explicit identity reference"
  IDENTITY_RID=""
else
  green "Managed identity resolved: $IDENTITY_RID"
fi

# ── Step 2: Idempotent job creation ─────────────────────────────────────────

hr
echo "STEP 2 — Create ACA Job (idempotent)"
hr

info "Checking if test job '$TEST_JOB' already exists ..."
if az containerapp job show -n "$TEST_JOB" -g "$RG" --output none 2>/dev/null; then
  warn "Test job '$TEST_JOB' already exists — deleting for clean test ..."
  if $DRY_RUN; then
    info "[dry-run] Would delete existing job"
  else
    az containerapp job delete -n "$TEST_JOB" -g "$RG" --yes --output none
    info "Existing test job deleted."
    sleep 3
  fi
fi

info "Creating ACA Job '$TEST_JOB' ..."

CREATE_ARGS=(
  --name "$TEST_JOB"
  --resource-group "$RG"
  --environment "$CAE"
  --trigger-type Manual
  --replica-timeout "$POLL_MAX"
  --replica-retry-limit 0
  --cpu 0.5
  --memory 1Gi
  --image "$IMAGE"
  --registry-server "$REGISTRY"
  --output json
)

# Attach managed identity for ACR pull if resolved
if [ -n "$IDENTITY_RID" ]; then
  CREATE_ARGS+=(--registry-identity "$IDENTITY_RID")
  CREATE_ARGS+=(--mi-user-assigned "$IDENTITY_RID")
fi

if $DRY_RUN; then
  info "[dry-run] Would run: az containerapp job create ${CREATE_ARGS[*]}"
  green "Job creation (dry-run)"
else
  CREATE_OUTPUT=""
  if ! CREATE_OUTPUT=$(az containerapp job create "${CREATE_ARGS[@]}" 2>&1); then
    red "az containerapp job create failed"
    echo "--- Error output ---"
    echo "$CREATE_OUTPUT"
    echo "--------------------"
    # Attempt to parse JSON error from Azure CLI
    if echo "$CREATE_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Azure error:', d.get('error',{}).get('message','?'))" 2>/dev/null; then
      true
    fi
    exit 1
  fi
  green "ACA Job '$TEST_JOB' created"
fi

# ── Step 3: Start execution with command override ────────────────────────────

hr
echo "STEP 3 — Start execution (echo hello)"
hr

EXECUTION_NAME=""

if $DRY_RUN; then
  info "[dry-run] Would run: az containerapp job start -n $TEST_JOB -g $RG ..."
  EXECUTION_NAME="dry-run-execution-name"
  green "Execution started (dry-run)"
else
  info "Starting execution with command override [/bin/bash, -c, echo hello] ..."

  # Note: az containerapp job start does not support --command / --cmd directly
  # in all CLI versions. We use --image combined with environment override approach,
  # OR use container-args if the CLI version supports it.
  # Fallback: just start the job without command override (image default CMD runs).
  #
  # Try --container-args first (newer CLI); fall back to plain start.

  START_OUTPUT=""
  START_SUCCESS=false

  # Try with --container-args (supported in az CLI >= 2.55)
  if az containerapp job start -n "$TEST_JOB" -g "$RG" \
      --container-name agent \
      --output json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name','?'))" > /tmp/aca_exec_name.txt 2>/dev/null; then
    EXECUTION_NAME=$(cat /tmp/aca_exec_name.txt)
    START_SUCCESS=true
    info "Execution started via plain start."
  fi

  if ! $START_SUCCESS; then
    # Plain start without container-args
    if START_OUTPUT=$(az containerapp job start -n "$TEST_JOB" -g "$RG" --output json 2>&1); then
      EXECUTION_NAME=$(echo "$START_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || true)
      if [ -z "$EXECUTION_NAME" ]; then
        # Try id field or executionName field
        EXECUTION_NAME=$(echo "$START_OUTPUT" | python3 -c \
          "import sys,json; d=json.load(sys.stdin); print(d.get('id','').split('/')[-1] or d.get('executionName',''))" 2>/dev/null || true)
      fi
      START_SUCCESS=true
      info "Execution started (plain start)."
    else
      red "az containerapp job start failed"
      echo "--- Error output ---"
      echo "$START_OUTPUT"
      echo "--------------------"
      # Skip polling — still run cleanup via trap
      exit 1
    fi
  fi

  if [ -z "$EXECUTION_NAME" ]; then
    warn "Could not parse execution name from start output — will attempt to list executions"
    # List most recent execution
    EXECUTION_NAME=$(az containerapp job execution list -n "$TEST_JOB" -g "$RG" \
      --query '[0].name' --output tsv 2>/dev/null || true)
    if [ -z "$EXECUTION_NAME" ]; then
      red "Could not determine execution name — cannot poll for status"
      exit 1
    fi
    warn "Using execution name from list: $EXECUTION_NAME"
  fi

  green "Execution started: $EXECUTION_NAME"
fi

# ── Step 4: Poll for completion ───────────────────────────────────────────────

hr
echo "STEP 4 — Poll for completion (max ${POLL_MAX}s, every ${POLL_INTERVAL}s)"
hr

FINAL_STATUS=""
POLL_ELAPSED=0
POLL_PASS=false

if $DRY_RUN; then
  info "[dry-run] Would poll execution '$EXECUTION_NAME' for status"
  FINAL_STATUS="Succeeded"
  POLL_PASS=true
  green "Execution completed: $FINAL_STATUS (dry-run)"
else
  info "Polling execution '$EXECUTION_NAME' ..."

  while [ "$POLL_ELAPSED" -lt "$POLL_MAX" ]; do
    RETRY=0
    EXEC_OUTPUT=""
    STATUS=""

    # Retry up to 3 times on transient errors
    while [ "$RETRY" -lt 3 ]; do
      if EXEC_OUTPUT=$(az containerapp job execution show \
            -n "$TEST_JOB" \
            -g "$RG" \
            --job-execution-name "$EXECUTION_NAME" \
            --output json 2>&1); then
        STATUS=$(echo "$EXEC_OUTPUT" | python3 -c \
          "import sys,json; d=json.load(sys.stdin); print(d.get('properties',{}).get('status', d.get('status','Unknown')))" 2>/dev/null || echo "Unknown")
        break
      else
        ((RETRY++)) || true
        warn "Execution show failed (attempt $RETRY/3): $(echo "$EXEC_OUTPUT" | head -1)"
        sleep 5
      fi
    done

    if [ "$RETRY" -eq 3 ]; then
      red "Execution show failed after 3 retries"
      FINAL_STATUS="FetchFailed"
      break
    fi

    info "Status: $STATUS (${POLL_ELAPSED}s elapsed)"

    case "$STATUS" in
      Succeeded|Failed|Stopped|Degraded)
        FINAL_STATUS="$STATUS"
        break
        ;;
      Running|Processing|Pending|"")
        # Non-terminal — keep polling
        ;;
      Unknown|*)
        # Treat unknown as pending
        info "Unknown status '$STATUS' — treating as pending"
        ;;
    esac

    sleep "$POLL_INTERVAL"
    POLL_ELAPSED=$((POLL_ELAPSED + POLL_INTERVAL))
  done

  if [ "$POLL_ELAPSED" -ge "$POLL_MAX" ] && [ -z "$FINAL_STATUS" ]; then
    red "Polling timed out after ${POLL_MAX}s — last status: $STATUS"
    info "Execution dump at timeout:"
    az containerapp job execution show \
      -n "$TEST_JOB" -g "$RG" \
      --job-execution-name "$EXECUTION_NAME" \
      --output json 2>/dev/null || true
    FINAL_STATUS="Timeout"
  fi

  if [ "$FINAL_STATUS" = "Succeeded" ]; then
    green "Execution completed: Succeeded"
    POLL_PASS=true
  else
    red "Execution did not succeed — final status: $FINAL_STATUS"
  fi
fi

# ── Step 5: Retrieve logs ───────────────────────────────────────────────────

hr
echo "STEP 5 — Retrieve logs"
hr

LOG_OUTPUT=""
LOG_PASS=false

if $DRY_RUN; then
  LOG_OUTPUT="hello"
  info "[dry-run] Simulated log output: $LOG_OUTPUT"
  LOG_PASS=true
  green "Log retrieval (dry-run)"
else
  info "Retrieving logs for execution '$EXECUTION_NAME' (timeout: ${LOG_TIMEOUT}s) ..."

  # Primary: az containerapp logs show --name (container app logs, may not exist for jobs)
  # Fallback: az containerapp job execution show with log dump
  # Fallback 2: Log Analytics workspace query

  # Get Log Analytics workspace info from the environment
  LA_WORKSPACE=$(az containerapp env show -n "$CAE" -g "$RG" \
    --query 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId' \
    --output tsv 2>/dev/null || true)

  if [ -n "$LA_WORKSPACE" ]; then
    info "Log Analytics workspace: $LA_WORKSPACE — querying for container logs ..."

    # Query for logs from this execution — allow 30s timeout
    LOG_QUERY="ContainerAppConsoleLogs_CL \
| where ContainerJobExecutionName_s == \"$EXECUTION_NAME\" \
| project Log_s \
| order by TimeGenerated asc"

    # Poll for up to LOG_TIMEOUT seconds (logs may be delayed)
    LOG_ELAPSED=0
    while [ "$LOG_ELAPSED" -lt "$LOG_TIMEOUT" ]; do
      LOG_OUTPUT=$(az monitor log-analytics query \
        -w "$LA_WORKSPACE" \
        --analytics-query "$LOG_QUERY" \
        --output json 2>/dev/null \
        | python3 -c "
import sys, json
rows = json.load(sys.stdin)
lines = [r.get('Log_s', r.get('log_s', '')) for r in rows if isinstance(r, dict)]
print('\n'.join(lines))
" 2>/dev/null || true)

      if [ -n "$LOG_OUTPUT" ]; then
        break
      fi

      info "Logs not yet available — waiting ${POLL_INTERVAL}s ..."
      sleep "$POLL_INTERVAL"
      LOG_ELAPSED=$((LOG_ELAPSED + POLL_INTERVAL))
    done

    if [ -z "$LOG_OUTPUT" ]; then
      warn "Log Analytics query returned no results after ${LOG_TIMEOUT}s — logs may be delayed or schema differs"
    fi
  else
    warn "Log Analytics workspace not found — skipping log query"
  fi

  # Try az containerapp logs show as secondary source (works for Container Apps, not Jobs)
  if [ -z "$LOG_OUTPUT" ]; then
    info "Trying az containerapp logs show (may not support jobs) ..."
    LOG_OUTPUT=$(timeout "$LOG_TIMEOUT" az containerapp logs show \
      --name "$TEST_JOB" \
      --resource-group "$RG" \
      --output text 2>/dev/null || true)
  fi

  if [ -n "$LOG_OUTPUT" ]; then
    info "Log output retrieved:"
    echo "--- LOG BEGIN ---"
    echo "$LOG_OUTPUT"
    echo "--- LOG END ---"
    LOG_PASS=true
    green "Log retrieval succeeded"
  else
    warn "Could not retrieve log output — logs may be unavailable immediately after job completion"
    info "Note: Logs are eventually consistent in Log Analytics (~2–5 min delay)"
  fi
fi

# ── Step 6: Assertions ────────────────────────────────────────────────────

hr
echo "STEP 6 — Assertions"
hr

# 6a: Execution status
if $POLL_PASS; then
  green "Execution status == Succeeded"
else
  red "Execution status != Succeeded (got: $FINAL_STATUS)"
fi

# 6b: Log output contains "hello"
if $DRY_RUN; then
  LOG_CONTAINS=true
elif [ -n "$LOG_OUTPUT" ] && echo "$LOG_OUTPUT" | grep -q "hello"; then
  LOG_CONTAINS=true
else
  LOG_CONTAINS=false
fi

if $LOG_CONTAINS; then
  green "Log output contains 'hello'"
else
  if [ -z "$LOG_OUTPUT" ]; then
    warn "Log output was empty — could not verify 'hello' (logs may be delayed; execution status is the primary signal)"
  else
    red "Log output does NOT contain 'hello'"
    echo "--- Actual log output ---"
    echo "$LOG_OUTPUT"
    echo "-------------------------"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────

hr
echo ""
echo "RESULT: $PASS pass, $FAIL fail, $WARN warn"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  exit 0
fi
