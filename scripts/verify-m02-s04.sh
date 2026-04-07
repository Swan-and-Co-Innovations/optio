#!/usr/bin/env bash
# verify-m02-s04.sh — Verification harness for M002/S04 success criteria
#
# Offline checks (always run):
#   1.  scripts/aca-job-template.json exists and is valid JSON
#   2.  aca-job-template.json has >= 2 KV-backed secrets
#   3.  aca-job-template.json env maps ANTHROPIC_API_KEY and GITHUB_TOKEN via secretRef
#   4.  aca-job-template.json references __SUBSCRIPTION_ID__ placeholder
#   5.  aca-job-template.json references id-ppf-aca-dev-eastus managed identity
#   6.  scripts/preflight-secrets.sh exists and passes bash -n syntax check
#   7.  preflight-secrets.sh references anthropic-api-key secret name
#   8.  preflight-secrets.sh references GITHUB-TOKEN secret name
#   9.  preflight-secrets.sh uses PASS/FAIL reporting
#   10. scripts/smoke-test-e2e.sh exists and passes bash -n syntax check
#   11. smoke-test-e2e.sh has --dry-run support
#   12. smoke-test-e2e.sh references [entrypoint] log signal
#   13. smoke-test-e2e.sh calls preflight-secrets.sh
#   14. smoke-test-e2e.sh has cleanup trap
#   15. KV secret names in aca-job-template.json match preflight-secrets.sh checked names
#
# Live checks (--live only):
#   16. KV secrets are accessible via az keyvault secret show
#   17. ACR image gsd-agent:m001 exists in the registry
#
# Usage:
#   bash scripts/verify-m02-s04.sh           # offline checks only
#   bash scripts/verify-m02-s04.sh --live    # includes live Azure checks
#
# Exit codes:
#   0 — all non-skipped checks passed
#   1 — one or more checks failed

set -uo pipefail

LIVE=false
for arg in "$@"; do
  [[ "$arg" == "--live" ]] && LIVE=true
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# All file-existence tests and node calls use paths relative to ROOT
# (node.exe on Windows cannot resolve MSYS absolute paths like /w/Repos/...)
cd "$ROOT"

PASS=0
FAIL=0
SKIP=0

check_pass() { echo "  [PASS] $*"; (( PASS++ )) || true; }
check_fail() { echo "  [FAIL] $*"; (( FAIL++ )) || true; }
check_skip() { echo "  [SKIP] $*"; (( SKIP++ )) || true; }
section()    { echo; echo "--- $* ---"; }

JOB_TEMPLATE="scripts/aca-job-template.json"
PREFLIGHT_SCRIPT="scripts/preflight-secrets.sh"
SMOKE_SCRIPT="scripts/smoke-test-e2e.sh"
KV_NAME="kv-ppf-dev-eastus"
ACR_NAME="acrdevd2thdvq46mgnw"
AGENT_IMAGE="gsd-agent:m001"

echo "=== M002/S04 Verification ==="
echo "Root: $ROOT"
[[ "$LIVE" == "true" ]] && echo "Mode: LIVE (Azure checks enabled)" || echo "Mode: OFFLINE (static checks only)"

# ---------------------------------------------------------------------------
# Check 1: scripts/aca-job-template.json exists and is valid JSON
# ---------------------------------------------------------------------------
section "Check 1: scripts/aca-job-template.json exists and is valid JSON"
if [[ -f "$JOB_TEMPLATE" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$JOB_TEMPLATE','utf8'))" 2>/dev/null; then
    check_pass "$JOB_TEMPLATE exists and is valid JSON"
  else
    check_fail "$JOB_TEMPLATE exists but is not valid JSON"
  fi
else
  check_fail "$JOB_TEMPLATE not found"
fi

# ---------------------------------------------------------------------------
# Check 2: aca-job-template.json has >= 2 KV-backed secrets
# ---------------------------------------------------------------------------
section "Check 2: aca-job-template.json has >= 2 KV-backed secrets"
if [[ -f "$JOB_TEMPLATE" ]]; then
  KV_CHECK=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$JOB_TEMPLATE','utf8'));
  var secrets = (d.configuration && d.configuration.secrets) || [];
  var kvSecrets = secrets.filter(function(s){ return s.keyVaultUrl; });
  if (kvSecrets.length < 2) {
    process.stderr.write('only ' + kvSecrets.length + ' KV secret(s) found (need >= 2)\n');
    process.exit(1);
  }
  process.stdout.write('kvSecrets=' + kvSecrets.length + ',names=' + kvSecrets.map(function(s){ return s.name; }).join(',') + '\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && KV_EXIT=0 || KV_EXIT=$?
  if [[ "$KV_EXIT" -eq 0 ]]; then
    check_pass "aca-job-template.json has KV-backed secrets ($KV_CHECK)"
  else
    check_fail "aca-job-template.json KV secrets check failed: $KV_CHECK"
  fi
else
  check_skip "$JOB_TEMPLATE not found — skipping KV secrets check"
fi

# ---------------------------------------------------------------------------
# Check 3: aca-job-template.json env maps ANTHROPIC_API_KEY and GITHUB_TOKEN via secretRef
# ---------------------------------------------------------------------------
section "Check 3: aca-job-template.json env maps ANTHROPIC_API_KEY and GITHUB_TOKEN via secretRef"
if [[ -f "$JOB_TEMPLATE" ]]; then
  ENV_CHECK=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$JOB_TEMPLATE','utf8'));
  var containers = (d.template && d.template.containers) || [];
  var envVars = (containers[0] && containers[0].env) || [];

  var anthropicEnv = envVars.find(function(e){ return e.name === 'ANTHROPIC_API_KEY' && e.secretRef; });
  var githubEnv    = envVars.find(function(e){ return e.name === 'GITHUB_TOKEN'      && e.secretRef; });

  if (!anthropicEnv) { process.stderr.write('ANTHROPIC_API_KEY not wired as secretRef in env\n'); process.exit(1); }
  if (!githubEnv)    { process.stderr.write('GITHUB_TOKEN not wired as secretRef in env\n');      process.exit(1); }

  process.stdout.write('ANTHROPIC_API_KEY->'+anthropicEnv.secretRef+',GITHUB_TOKEN->'+githubEnv.secretRef+'\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && ENV_EXIT=0 || ENV_EXIT=$?
  if [[ "$ENV_EXIT" -eq 0 ]]; then
    check_pass "aca-job-template.json env wired correctly ($ENV_CHECK)"
  else
    check_fail "aca-job-template.json env check failed: $ENV_CHECK"
  fi
else
  check_skip "$JOB_TEMPLATE not found — skipping env check"
fi

# ---------------------------------------------------------------------------
# Check 4: aca-job-template.json references __SUBSCRIPTION_ID__ placeholder
# ---------------------------------------------------------------------------
section "Check 4: aca-job-template.json references __SUBSCRIPTION_ID__ placeholder"
if [[ -f "$JOB_TEMPLATE" ]]; then
  if grep -q '__SUBSCRIPTION_ID__' "$JOB_TEMPLATE"; then
    check_pass "$JOB_TEMPLATE references __SUBSCRIPTION_ID__ placeholder (parameterized)"
  else
    check_fail "$JOB_TEMPLATE does not reference __SUBSCRIPTION_ID__ placeholder"
  fi
else
  check_skip "$JOB_TEMPLATE not found — skipping parameterization check"
fi

# ---------------------------------------------------------------------------
# Check 5: aca-job-template.json references id-ppf-aca-dev-eastus managed identity
# ---------------------------------------------------------------------------
section "Check 5: aca-job-template.json references id-ppf-aca-dev-eastus managed identity"
if [[ -f "$JOB_TEMPLATE" ]]; then
  if grep -q 'id-ppf-aca-dev-eastus' "$JOB_TEMPLATE"; then
    check_pass "$JOB_TEMPLATE references id-ppf-aca-dev-eastus managed identity"
  else
    check_fail "$JOB_TEMPLATE does not reference id-ppf-aca-dev-eastus managed identity"
  fi
else
  check_skip "$JOB_TEMPLATE not found — skipping identity check"
fi

# ---------------------------------------------------------------------------
# Check 6: scripts/preflight-secrets.sh exists and passes bash -n syntax check
# ---------------------------------------------------------------------------
section "Check 6: scripts/preflight-secrets.sh exists and passes bash -n"
if [[ -f "$PREFLIGHT_SCRIPT" ]]; then
  if command -v bash &>/dev/null; then
    BASH_N_OUT=$(bash -n "$PREFLIGHT_SCRIPT" 2>&1) && BASH_N_EXIT=0 || BASH_N_EXIT=$?
    if [[ "$BASH_N_EXIT" -eq 0 ]]; then
      check_pass "$PREFLIGHT_SCRIPT exists and passes bash -n syntax check"
    else
      check_fail "$PREFLIGHT_SCRIPT failed bash -n: $BASH_N_OUT"
    fi
  else
    check_skip "bash not available — skipping syntax check"
  fi
else
  check_fail "$PREFLIGHT_SCRIPT not found"
fi

# ---------------------------------------------------------------------------
# Check 7: preflight-secrets.sh references anthropic-api-key secret name
# ---------------------------------------------------------------------------
section "Check 7: preflight-secrets.sh references anthropic-api-key"
if [[ -f "$PREFLIGHT_SCRIPT" ]]; then
  if grep -q 'anthropic-api-key' "$PREFLIGHT_SCRIPT"; then
    check_pass "$PREFLIGHT_SCRIPT references anthropic-api-key secret"
  else
    check_fail "$PREFLIGHT_SCRIPT does not reference anthropic-api-key secret"
  fi
else
  check_skip "$PREFLIGHT_SCRIPT not found — skipping secret name check"
fi

# ---------------------------------------------------------------------------
# Check 8: preflight-secrets.sh references GITHUB-TOKEN secret name
# ---------------------------------------------------------------------------
section "Check 8: preflight-secrets.sh references GITHUB-TOKEN"
if [[ -f "$PREFLIGHT_SCRIPT" ]]; then
  if grep -q 'GITHUB-TOKEN' "$PREFLIGHT_SCRIPT"; then
    check_pass "$PREFLIGHT_SCRIPT references GITHUB-TOKEN secret"
  else
    check_fail "$PREFLIGHT_SCRIPT does not reference GITHUB-TOKEN secret"
  fi
else
  check_skip "$PREFLIGHT_SCRIPT not found — skipping secret name check"
fi

# ---------------------------------------------------------------------------
# Check 9: preflight-secrets.sh uses PASS/FAIL reporting
# ---------------------------------------------------------------------------
section "Check 9: preflight-secrets.sh uses PASS/FAIL reporting"
if [[ -f "$PREFLIGHT_SCRIPT" ]]; then
  HAS_PASS=false
  HAS_FAIL=false
  grep -q 'PASS' "$PREFLIGHT_SCRIPT" && HAS_PASS=true
  grep -q 'FAIL' "$PREFLIGHT_SCRIPT" && HAS_FAIL=true
  if [[ "$HAS_PASS" == "true" && "$HAS_FAIL" == "true" ]]; then
    check_pass "$PREFLIGHT_SCRIPT uses PASS/FAIL reporting pattern"
  elif [[ "$HAS_PASS" == "false" ]]; then
    check_fail "$PREFLIGHT_SCRIPT does not use PASS reporting"
  else
    check_fail "$PREFLIGHT_SCRIPT does not use FAIL reporting"
  fi
else
  check_skip "$PREFLIGHT_SCRIPT not found — skipping reporting check"
fi

# ---------------------------------------------------------------------------
# Check 10: scripts/smoke-test-e2e.sh exists and passes bash -n syntax check
# ---------------------------------------------------------------------------
section "Check 10: scripts/smoke-test-e2e.sh exists and passes bash -n"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  if command -v bash &>/dev/null; then
    BASH_N_OUT=$(bash -n "$SMOKE_SCRIPT" 2>&1) && BASH_N_EXIT=0 || BASH_N_EXIT=$?
    if [[ "$BASH_N_EXIT" -eq 0 ]]; then
      check_pass "$SMOKE_SCRIPT exists and passes bash -n syntax check"
    else
      check_fail "$SMOKE_SCRIPT failed bash -n: $BASH_N_OUT"
    fi
  else
    check_skip "bash not available — skipping syntax check"
  fi
else
  check_fail "$SMOKE_SCRIPT not found"
fi

# ---------------------------------------------------------------------------
# Check 11: smoke-test-e2e.sh has --dry-run support
# ---------------------------------------------------------------------------
section "Check 11: smoke-test-e2e.sh has --dry-run support"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  if grep -q -- '--dry-run' "$SMOKE_SCRIPT"; then
    check_pass "$SMOKE_SCRIPT has --dry-run argument support"
  else
    check_fail "$SMOKE_SCRIPT does not reference --dry-run flag"
  fi
else
  check_skip "$SMOKE_SCRIPT not found — skipping --dry-run check"
fi

# ---------------------------------------------------------------------------
# Check 12: smoke-test-e2e.sh references [entrypoint] log signal
# ---------------------------------------------------------------------------
section "Check 12: smoke-test-e2e.sh references [entrypoint] log signal"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  if grep -q 'entrypoint' "$SMOKE_SCRIPT"; then
    check_pass "$SMOKE_SCRIPT references [entrypoint] log signal"
  else
    check_fail "$SMOKE_SCRIPT does not reference [entrypoint] log signal"
  fi
else
  check_skip "$SMOKE_SCRIPT not found — skipping entrypoint check"
fi

# ---------------------------------------------------------------------------
# Check 13: smoke-test-e2e.sh calls preflight-secrets.sh
# ---------------------------------------------------------------------------
section "Check 13: smoke-test-e2e.sh calls preflight-secrets.sh"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  if grep -q 'preflight' "$SMOKE_SCRIPT"; then
    check_pass "$SMOKE_SCRIPT calls preflight-secrets.sh"
  else
    check_fail "$SMOKE_SCRIPT does not reference preflight"
  fi
else
  check_skip "$SMOKE_SCRIPT not found — skipping preflight call check"
fi

# ---------------------------------------------------------------------------
# Check 14: smoke-test-e2e.sh has cleanup trap
# ---------------------------------------------------------------------------
section "Check 14: smoke-test-e2e.sh has cleanup trap"
if [[ -f "$SMOKE_SCRIPT" ]]; then
  if grep -q 'cleanup' "$SMOKE_SCRIPT"; then
    check_pass "$SMOKE_SCRIPT has cleanup trap reference"
  else
    check_fail "$SMOKE_SCRIPT does not reference cleanup"
  fi
else
  check_skip "$SMOKE_SCRIPT not found — skipping cleanup check"
fi

# ---------------------------------------------------------------------------
# Check 15: KV secret names in aca-job-template.json match preflight-secrets.sh
# ---------------------------------------------------------------------------
section "Check 15: KV secret names in aca-job-template.json match preflight-secrets.sh"
if [[ -f "$JOB_TEMPLATE" && -f "$PREFLIGHT_SCRIPT" ]]; then
  # Extract secret names from template
  TEMPLATE_SECRETS=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$JOB_TEMPLATE','utf8'));
  var secrets = (d.configuration && d.configuration.secrets) || [];
  var names = secrets.map(function(s){ return s.name; });
  process.stdout.write(names.join('\n'));
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>/dev/null || echo "")

  MISMATCH=false
  while IFS= read -r secret_name; do
    [[ -z "$secret_name" ]] && continue
    # Map template secret name to KV secret name (name in template vs vault secret name in URL)
    kv_name=""
    case "$secret_name" in
      anthropic-api-key) kv_name="anthropic-api-key" ;;
      github-token)      kv_name="GITHUB-TOKEN" ;;
      *)                 kv_name="$secret_name" ;;
    esac
    if ! grep -q "$kv_name" "$PREFLIGHT_SCRIPT"; then
      check_fail "Secret '$secret_name' (KV: $kv_name) in template not checked by $PREFLIGHT_SCRIPT"
      MISMATCH=true
    fi
  done <<< "$TEMPLATE_SECRETS"

  if [[ "$MISMATCH" == "false" ]]; then
    check_pass "All template KV secret names are checked by $PREFLIGHT_SCRIPT"
  fi
else
  check_skip "Template or preflight script not found — skipping cross-reference check"
fi

# ---------------------------------------------------------------------------
# Live checks (--live only)
# ---------------------------------------------------------------------------

# Check 16: KV secrets are accessible via az keyvault secret show
section "Check 16: KV secrets are accessible (live)"
if [[ "$LIVE" == "true" ]]; then
  if ! command -v az &>/dev/null; then
    check_skip "az CLI not found — cannot run live KV check"
  else
    KV_SECRETS_TO_CHECK=("anthropic-api-key" "GITHUB-TOKEN")
    KV_FAIL_COUNT=0
    for secret in "${KV_SECRETS_TO_CHECK[@]}"; do
      if az keyvault secret show \
          --vault-name "$KV_NAME" \
          --name "$secret" \
          --query "name" -o tsv &>/dev/null 2>&1; then
        check_pass "KV secret '$secret' is accessible in $KV_NAME"
      else
        check_fail "KV secret '$secret' not found or inaccessible in $KV_NAME"
        (( KV_FAIL_COUNT++ )) || true
      fi
    done
  fi
else
  check_skip "Live KV check — pass --live flag to enable"
fi

# Check 17: ACR image gsd-agent:m001 exists
section "Check 17: ACR image gsd-agent:m001 exists (live)"
if [[ "$LIVE" == "true" ]]; then
  if ! command -v az &>/dev/null; then
    check_skip "az CLI not found — cannot run live ACR check"
  else
    if az acr repository show \
        --name "$ACR_NAME" \
        --image "$AGENT_IMAGE" \
        --output none 2>/dev/null; then
      check_pass "ACR image ${ACR_NAME}.azurecr.io/${AGENT_IMAGE} exists"
    else
      check_fail "ACR image ${ACR_NAME}.azurecr.io/${AGENT_IMAGE} not found — run az acr build first"
    fi
  fi
else
  check_skip "Live ACR check — pass --live flag to enable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================"
echo " M002/S04 Verification Summary"
echo "============================================"
echo "  Passed:  $PASS"
echo "  Failed:  $FAIL"
echo "  Skipped: $SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL check(s) failed."
  exit 1
else
  echo ""
  echo "RESULT: PASS — All non-skipped checks passed."
  exit 0
fi
