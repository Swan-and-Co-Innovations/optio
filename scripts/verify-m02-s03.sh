#!/usr/bin/env bash
# verify-m02-s03.sh — Verification harness for M002/S03 success criteria
#
# Offline checks (always run):
#   1.  scripts/optio-api-template.json exists and is valid JSON
#   2.  scripts/optio-web-template.json exists and is valid JSON
#   3.  API template has internal ingress (external: false, transport: auto)
#   4.  Web template has external ingress (external: true, transport: auto)
#   5.  Both templates reference __SUBSCRIPTION_ID__ placeholder
#   6.  Both templates reference cae-dev-eastus environment
#   7.  API template has KV secret references (DATABASE_URL, REDIS_URL)
#   8.  scripts/deploy-optio-apps.sh exists and passes bash -n syntax check
#   9.  Deploy script has --dry-run support
#
# Live checks (--live only):
#   10. az containerapp show for optio-api returns provisioned state
#   11. az containerapp show for optio-web returns provisioned state
#   12. Optio Web external FQDN is reachable (HTTP 200)
#   13. Optio API /health returns 200 (via internal URL)
#
# Usage:
#   bash scripts/verify-m02-s03.sh           # offline checks only
#   bash scripts/verify-m02-s03.sh --live    # includes live Azure checks
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

RG="rg-avd-dev-eastus"
API_APP_NAME="optio-api"
WEB_APP_NAME="optio-web"
API_TEMPLATE="scripts/optio-api-template.json"
WEB_TEMPLATE="scripts/optio-web-template.json"
DEPLOY_SCRIPT="scripts/deploy-optio-apps.sh"

echo "=== M002/S03 Verification ==="
echo "Root: $ROOT"
[[ "$LIVE" == "true" ]] && echo "Mode: LIVE (Azure checks enabled)" || echo "Mode: OFFLINE (static checks only)"

# ---------------------------------------------------------------------------
# Check 1: scripts/optio-api-template.json exists and is valid JSON
# ---------------------------------------------------------------------------
section "Check 1: scripts/optio-api-template.json exists and is valid JSON"
if [[ -f "$API_TEMPLATE" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$API_TEMPLATE','utf8'))" 2>/dev/null; then
    check_pass "$API_TEMPLATE exists and is valid JSON"
  else
    check_fail "$API_TEMPLATE exists but is not valid JSON"
  fi
else
  check_fail "$API_TEMPLATE not found"
fi

# ---------------------------------------------------------------------------
# Check 2: scripts/optio-web-template.json exists and is valid JSON
# ---------------------------------------------------------------------------
section "Check 2: scripts/optio-web-template.json exists and is valid JSON"
if [[ -f "$WEB_TEMPLATE" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$WEB_TEMPLATE','utf8'))" 2>/dev/null; then
    check_pass "$WEB_TEMPLATE exists and is valid JSON"
  else
    check_fail "$WEB_TEMPLATE exists but is not valid JSON"
  fi
else
  check_fail "$WEB_TEMPLATE not found"
fi

# ---------------------------------------------------------------------------
# Check 3: API template has internal ingress (external: false, transport: auto)
# ---------------------------------------------------------------------------
section "Check 3: API template has internal ingress (external: false, transport: auto)"
if [[ -f "$API_TEMPLATE" ]]; then
  API_INGRESS=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$API_TEMPLATE','utf8'));
  var ing = (d.properties && d.properties.configuration && d.properties.configuration.ingress)
            || d.ingress || null;
  if (!ing) { process.stderr.write('no ingress block found\n'); process.exit(1); }
  if (ing.external !== false) { process.stderr.write('external is not false (got: ' + ing.external + ')\n'); process.exit(1); }
  if (ing.transport !== 'auto') { process.stderr.write('transport is not auto (got: ' + ing.transport + ')\n'); process.exit(1); }
  process.stdout.write('external=' + ing.external + ',transport=' + ing.transport + '\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && API_ING_EXIT=0 || API_ING_EXIT=$?
  if [[ "$API_ING_EXIT" -eq 0 ]]; then
    check_pass "API template has internal ingress ($API_INGRESS)"
  else
    check_fail "API template ingress check failed: $API_INGRESS"
  fi
else
  check_skip "API template not found — skipping ingress check"
fi

# ---------------------------------------------------------------------------
# Check 4: Web template has external ingress (external: true, transport: auto)
# ---------------------------------------------------------------------------
section "Check 4: Web template has external ingress (external: true, transport: auto)"
if [[ -f "$WEB_TEMPLATE" ]]; then
  WEB_INGRESS=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$WEB_TEMPLATE','utf8'));
  var ing = (d.properties && d.properties.configuration && d.properties.configuration.ingress)
            || d.ingress || null;
  if (!ing) { process.stderr.write('no ingress block found\n'); process.exit(1); }
  if (ing.external !== true) { process.stderr.write('external is not true (got: ' + ing.external + ')\n'); process.exit(1); }
  if (ing.transport !== 'auto') { process.stderr.write('transport is not auto (got: ' + ing.transport + ')\n'); process.exit(1); }
  process.stdout.write('external=' + ing.external + ',transport=' + ing.transport + '\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && WEB_ING_EXIT=0 || WEB_ING_EXIT=$?
  if [[ "$WEB_ING_EXIT" -eq 0 ]]; then
    check_pass "Web template has external ingress ($WEB_INGRESS)"
  else
    check_fail "Web template ingress check failed: $WEB_INGRESS"
  fi
else
  check_skip "Web template not found — skipping ingress check"
fi

# ---------------------------------------------------------------------------
# Check 5: Both templates reference __SUBSCRIPTION_ID__ placeholder
# ---------------------------------------------------------------------------
section "Check 5: Both templates reference __SUBSCRIPTION_ID__ placeholder"
API_HAS_SUB=false
WEB_HAS_SUB=false
[[ -f "$API_TEMPLATE" ]] && grep -q '__SUBSCRIPTION_ID__' "$API_TEMPLATE" && API_HAS_SUB=true
[[ -f "$WEB_TEMPLATE" ]] && grep -q '__SUBSCRIPTION_ID__' "$WEB_TEMPLATE" && WEB_HAS_SUB=true

if [[ "$API_HAS_SUB" == "true" && "$WEB_HAS_SUB" == "true" ]]; then
  check_pass "Both templates reference __SUBSCRIPTION_ID__ placeholder (parameterized)"
elif [[ "$API_HAS_SUB" == "false" && "$WEB_HAS_SUB" == "false" ]]; then
  check_fail "Neither template references __SUBSCRIPTION_ID__ placeholder"
elif [[ "$API_HAS_SUB" == "false" ]]; then
  check_fail "$API_TEMPLATE does not reference __SUBSCRIPTION_ID__"
else
  check_fail "$WEB_TEMPLATE does not reference __SUBSCRIPTION_ID__"
fi

# ---------------------------------------------------------------------------
# Check 6: Both templates reference cae-dev-eastus environment
# ---------------------------------------------------------------------------
section "Check 6: Both templates reference cae-dev-eastus environment"
API_HAS_CAE=false
WEB_HAS_CAE=false
[[ -f "$API_TEMPLATE" ]] && grep -q 'cae-dev-eastus' "$API_TEMPLATE" && API_HAS_CAE=true
[[ -f "$WEB_TEMPLATE" ]] && grep -q 'cae-dev-eastus' "$WEB_TEMPLATE" && WEB_HAS_CAE=true

if [[ "$API_HAS_CAE" == "true" && "$WEB_HAS_CAE" == "true" ]]; then
  check_pass "Both templates reference cae-dev-eastus environment"
elif [[ "$API_HAS_CAE" == "false" && "$WEB_HAS_CAE" == "false" ]]; then
  check_fail "Neither template references cae-dev-eastus"
elif [[ "$API_HAS_CAE" == "false" ]]; then
  check_fail "$API_TEMPLATE does not reference cae-dev-eastus"
else
  check_fail "$WEB_TEMPLATE does not reference cae-dev-eastus"
fi

# ---------------------------------------------------------------------------
# Check 7: API template has KV secret references (DATABASE_URL, REDIS_URL)
# ---------------------------------------------------------------------------
section "Check 7: API template has KV secret references (DATABASE_URL, REDIS_URL)"
if [[ -f "$API_TEMPLATE" ]]; then
  KV_CHECK=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$API_TEMPLATE','utf8'));
  var cfg = d.properties && d.properties.configuration;
  var secrets = (cfg && cfg.secrets) || [];
  var envVars = (d.properties && d.properties.template && d.properties.template.containers
    && d.properties.template.containers[0] && d.properties.template.containers[0].env) || [];

  // Check KV-backed secrets exist
  var kvSecrets = secrets.filter(function(s){ return s.keyVaultUrl; });
  if (kvSecrets.length === 0) { process.stderr.write('no keyVaultUrl secrets found\n'); process.exit(1); }

  // Check DATABASE_URL and REDIS_URL are wired via secretRef
  var dbEnv = envVars.find(function(e){ return e.name === 'DATABASE_URL' && e.secretRef; });
  var redisEnv = envVars.find(function(e){ return e.name === 'REDIS_URL' && e.secretRef; });
  if (!dbEnv) { process.stderr.write('DATABASE_URL not wired as secretRef in env vars\n'); process.exit(1); }
  if (!redisEnv) { process.stderr.write('REDIS_URL not wired as secretRef in env vars\n'); process.exit(1); }

  process.stdout.write('kvSecrets=' + kvSecrets.length + ',DATABASE_URL->'+dbEnv.secretRef+',REDIS_URL->'+redisEnv.secretRef+'\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && KV_EXIT=0 || KV_EXIT=$?
  if [[ "$KV_EXIT" -eq 0 ]]; then
    check_pass "API template has KV secret references ($KV_CHECK)"
  else
    check_fail "API template KV secret check failed: $KV_CHECK"
  fi
else
  check_skip "API template not found — skipping KV secret check"
fi

# ---------------------------------------------------------------------------
# Check 8: scripts/deploy-optio-apps.sh exists and passes bash -n syntax check
# ---------------------------------------------------------------------------
section "Check 8: scripts/deploy-optio-apps.sh exists and passes bash -n"
if [[ -f "$DEPLOY_SCRIPT" ]]; then
  if command -v bash &>/dev/null; then
    BASH_N_OUT=$(bash -n "$DEPLOY_SCRIPT" 2>&1) && BASH_N_EXIT=0 || BASH_N_EXIT=$?
    if [[ "$BASH_N_EXIT" -eq 0 ]]; then
      check_pass "$DEPLOY_SCRIPT exists and passes bash -n syntax check"
    else
      check_fail "$DEPLOY_SCRIPT failed bash -n: $BASH_N_OUT"
    fi
  else
    check_skip "bash not available — skipping syntax check"
  fi
else
  check_fail "$DEPLOY_SCRIPT not found"
fi

# ---------------------------------------------------------------------------
# Check 9: Deploy script has --dry-run support
# ---------------------------------------------------------------------------
section "Check 9: Deploy script has --dry-run support"
if [[ -f "$DEPLOY_SCRIPT" ]]; then
  if grep -q -- '--dry-run' "$DEPLOY_SCRIPT"; then
    check_pass "$DEPLOY_SCRIPT has --dry-run argument support"
  else
    check_fail "$DEPLOY_SCRIPT does not reference --dry-run flag"
  fi
else
  check_skip "$DEPLOY_SCRIPT not found — skipping --dry-run check"
fi

# ---------------------------------------------------------------------------
# Live checks (--live only)
# ---------------------------------------------------------------------------

# Check 10: az containerapp show for optio-api returns provisioned state
section "Check 10: optio-api Container App is provisioned (live)"
if [[ "$LIVE" == "true" ]]; then
  API_STATE=$(az containerapp show \
    --name "$API_APP_NAME" \
    --resource-group "$RG" \
    --query "properties.provisioningState" -o tsv 2>/dev/null || echo "")
  if [[ "$API_STATE" == "Succeeded" ]]; then
    check_pass "optio-api Container App is provisioned (state: $API_STATE)"
  else
    check_fail "optio-api Container App not in Succeeded state (got: '${API_STATE:-not found}')"
  fi
else
  check_skip "Live Azure check — pass --live flag to enable"
fi

# Check 11: az containerapp show for optio-web returns provisioned state
section "Check 11: optio-web Container App is provisioned (live)"
if [[ "$LIVE" == "true" ]]; then
  WEB_STATE=$(az containerapp show \
    --name "$WEB_APP_NAME" \
    --resource-group "$RG" \
    --query "properties.provisioningState" -o tsv 2>/dev/null || echo "")
  if [[ "$WEB_STATE" == "Succeeded" ]]; then
    check_pass "optio-web Container App is provisioned (state: $WEB_STATE)"
  else
    check_fail "optio-web Container App not in Succeeded state (got: '${WEB_STATE:-not found}')"
  fi
else
  check_skip "Live Azure check — pass --live flag to enable"
fi

# Check 12: Optio Web external FQDN is reachable
section "Check 12: Optio Web external FQDN is reachable (live)"
if [[ "$LIVE" == "true" ]]; then
  WEB_FQDN=$(az containerapp show \
    --name "$WEB_APP_NAME" \
    --resource-group "$RG" \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")
  if [[ -n "$WEB_FQDN" ]]; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${WEB_FQDN}" 2>/dev/null || echo "")
    if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "301" || "$HTTP_STATUS" == "302" ]]; then
      check_pass "Optio Web external URL https://${WEB_FQDN} is reachable (HTTP $HTTP_STATUS)"
    else
      check_fail "Optio Web https://${WEB_FQDN} returned HTTP ${HTTP_STATUS:-timeout/error}"
    fi
  else
    check_fail "Could not resolve Optio Web external FQDN — is optio-web deployed?"
  fi
else
  check_skip "Live reachability check — pass --live flag to enable"
fi

# Check 13: Optio API /health returns 200 (via internal URL)
section "Check 13: Optio API /health returns 200 (live)"
if [[ "$LIVE" == "true" ]]; then
  API_FQDN=$(az containerapp show \
    --name "$API_APP_NAME" \
    --resource-group "$RG" \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")
  if [[ -n "$API_FQDN" ]]; then
    HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${API_FQDN}/health" 2>/dev/null || echo "")
    if [[ "$HEALTH_STATUS" == "200" ]]; then
      check_pass "Optio API https://${API_FQDN}/health returned HTTP 200"
    else
      check_fail "Optio API /health returned HTTP ${HEALTH_STATUS:-timeout/error} (expected 200)"
    fi
  else
    check_fail "Could not resolve Optio API FQDN — is optio-api deployed?"
  fi
else
  check_skip "Live health check — pass --live flag to enable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================"
echo " M002/S03 Verification Summary"
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
