#!/usr/bin/env bash
# verify-m03-s02.sh — Offline verification for M003/S02 (Azure Monitor + App Insights workbook)
#
# All checks are file-based (no Azure CLI calls, no network) so they pass offline without
# Azure credentials.  Add --live to also run live Azure checks (requires az login).
#
# Exit codes:
#   0 — all offline checks passed (or all live checks passed when --live)
#   1 — one or more checks failed

set -uo pipefail

LIVE=false
for arg in "$@"; do
  [[ "$arg" == "--live" ]] && LIVE=true
done

PASS=0
FAIL=0
SKIP=0

pass() { echo "  [PASS] $*"; (( PASS++ )) || true; }
fail() { echo "  [FAIL] $*"; (( FAIL++ )) || true; }
skip() { echo "  [SKIP] $*"; (( SKIP++ )) || true; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "=== M003/S02 Offline Verification ==="
echo ""

# ---------------------------------------------------------------------------
# Check 1: alert-rule.json exists and is valid JSON
# ---------------------------------------------------------------------------
echo "--- Check 1: alert-rule.json exists and is valid JSON ---"
if [[ ! -f "scripts/monitoring/alert-rule.json" ]]; then
  fail "scripts/monitoring/alert-rule.json missing"
else
  if node -e "JSON.parse(require('fs').readFileSync('scripts/monitoring/alert-rule.json','utf8'))" 2>/dev/null; then
    pass "scripts/monitoring/alert-rule.json exists and is valid JSON"
  else
    fail "scripts/monitoring/alert-rule.json is not valid JSON"
  fi
fi

# ---------------------------------------------------------------------------
# Check 2: Alert template references optio-agent-job and rg-avd-dev-eastus
# ---------------------------------------------------------------------------
echo "--- Check 2: Alert template references optio-agent-job and rg-avd-dev-eastus ---"
JOB_REF=$(grep -l "optio-agent-job" "scripts/monitoring/alert-rule.json" 2>/dev/null)
RG_REF=$(grep -l "rg-avd-dev-eastus" "scripts/monitoring/alert-rule.json" 2>/dev/null)
if [[ -n "$JOB_REF" && -n "$RG_REF" ]]; then
  pass "Alert template references 'optio-agent-job' and 'rg-avd-dev-eastus'"
else
  [[ -z "$JOB_REF" ]] && fail "Alert template missing reference to 'optio-agent-job'"
  [[ -z "$RG_REF" ]] && fail "Alert template missing reference to 'rg-avd-dev-eastus'"
fi

# ---------------------------------------------------------------------------
# Check 3: Alert template uses __SUBSCRIPTION_ID__ placeholder (not hardcoded)
# ---------------------------------------------------------------------------
echo "--- Check 3: Alert template uses __SUBSCRIPTION_ID__ placeholder ---"
if grep -q "__SUBSCRIPTION_ID__" "scripts/monitoring/alert-rule.json" 2>/dev/null; then
  pass "Alert template contains __SUBSCRIPTION_ID__ placeholder"
else
  fail "Alert template does not contain __SUBSCRIPTION_ID__ placeholder (may be hardcoded)"
fi

# ---------------------------------------------------------------------------
# Check 4: Action group in alert template has email receiver placeholder
# ---------------------------------------------------------------------------
echo "--- Check 4: Action group has email receiver placeholder ---"
if grep -q "__ALERT_EMAIL__" "scripts/monitoring/alert-rule.json" 2>/dev/null; then
  pass "Alert template action group contains __ALERT_EMAIL__ placeholder"
else
  fail "Alert template action group missing __ALERT_EMAIL__ placeholder"
fi

# ---------------------------------------------------------------------------
# Check 5: workbook.json exists and is valid JSON
# ---------------------------------------------------------------------------
echo "--- Check 5: workbook.json exists and is valid JSON ---"
if [[ ! -f "scripts/monitoring/workbook.json" ]]; then
  fail "scripts/monitoring/workbook.json missing"
else
  if node -e "JSON.parse(require('fs').readFileSync('scripts/monitoring/workbook.json','utf8'))" 2>/dev/null; then
    pass "scripts/monitoring/workbook.json exists and is valid JSON"
  else
    fail "scripts/monitoring/workbook.json is not valid JSON"
  fi
fi

# ---------------------------------------------------------------------------
# Check 6: Workbook template contains KQL query strings
# ---------------------------------------------------------------------------
echo "--- Check 6: Workbook template contains KQL query strings ---"
WORKBOOK_KQL=$(node -e "
  try {
    const wb = JSON.parse(require('fs').readFileSync('scripts/monitoring/workbook.json','utf8'));
    const str = JSON.stringify(wb);
    const hasKQL = str.includes('ContainerAppSystemLogs_CL') || str.includes('ContainerAppConsoleLogs_CL') || str.includes('summarize');
    process.stdout.write(hasKQL ? 'yes' : 'no');
  } catch(e) { process.stdout.write('no'); }
" 2>/dev/null)
if [[ "$WORKBOOK_KQL" == "yes" ]]; then
  pass "Workbook template contains KQL query strings"
else
  fail "Workbook template does not contain expected KQL queries"
fi

# ---------------------------------------------------------------------------
# Check 7: Workbook template references __APP_INSIGHTS_ID__ placeholder
# ---------------------------------------------------------------------------
echo "--- Check 7: Workbook template uses __APP_INSIGHTS_ID__ placeholder ---"
if grep -q "__APP_INSIGHTS_ID__" "scripts/monitoring/workbook.json" 2>/dev/null; then
  pass "Workbook template contains __APP_INSIGHTS_ID__ placeholder"
else
  fail "Workbook template missing __APP_INSIGHTS_ID__ placeholder"
fi

# ---------------------------------------------------------------------------
# Check 8: deploy-monitoring.sh exists and passes bash -n syntax check
# ---------------------------------------------------------------------------
echo "--- Check 8: deploy-monitoring.sh exists and has valid bash syntax ---"
if [[ ! -f "scripts/deploy-monitoring.sh" ]]; then
  fail "scripts/deploy-monitoring.sh missing"
else
  if bash -n "scripts/deploy-monitoring.sh" 2>/dev/null; then
    pass "scripts/deploy-monitoring.sh exists and passes bash -n syntax check"
  else
    fail "scripts/deploy-monitoring.sh failed bash -n syntax check"
  fi
fi

# ---------------------------------------------------------------------------
# Check 9: Deploy script contains --dry-run flag handling
# ---------------------------------------------------------------------------
echo "--- Check 9: Deploy script contains --dry-run flag handling ---"
if grep -q "\-\-dry-run\|DRY_RUN" "scripts/deploy-monitoring.sh" 2>/dev/null; then
  pass "scripts/deploy-monitoring.sh contains --dry-run flag handling"
else
  fail "scripts/deploy-monitoring.sh missing --dry-run flag handling"
fi

# ---------------------------------------------------------------------------
# Check 10: Cross-reference job name between alert template and aca-job-template.json
# ---------------------------------------------------------------------------
echo "--- Check 10: Job name cross-reference (alert-rule.json vs aca-job-template.json) ---"
if [[ ! -f "scripts/aca-job-template.json" ]]; then
  skip "scripts/aca-job-template.json not found — skipping cross-reference check"
else
  JOB_IN_ALERT=$(grep "optio-agent-job" "scripts/monitoring/alert-rule.json" 2>/dev/null | head -1)
  JOB_IN_ACA=$(grep "optio-agent-job" "scripts/aca-job-template.json" 2>/dev/null | head -1)
  if [[ -n "$JOB_IN_ALERT" && -n "$JOB_IN_ACA" ]]; then
    pass "Job name 'optio-agent-job' consistent between alert-rule.json and aca-job-template.json"
  else
    fail "Job name mismatch: alert='${JOB_IN_ALERT:-<not found>}' aca='${JOB_IN_ACA:-<not found>}'"
  fi
fi

# ---------------------------------------------------------------------------
# Check 11: Deploy script contains workbook deployment step
# ---------------------------------------------------------------------------
echo "--- Check 11: Deploy script contains workbook deployment step ---"
if grep -q "workbook\|WORKBOOK" "scripts/deploy-monitoring.sh" 2>/dev/null; then
  pass "scripts/deploy-monitoring.sh contains workbook deployment logic"
else
  fail "scripts/deploy-monitoring.sh missing workbook deployment step"
fi

# ---------------------------------------------------------------------------
# Check 12: Workbook has both task-count and cost panels
# ---------------------------------------------------------------------------
echo "--- Check 12: Workbook has task-count panel and cost-estimation panel ---"
WORKBOOK_PANELS=$(node -e "
  try {
    const wb = JSON.parse(require('fs').readFileSync('scripts/monitoring/workbook.json','utf8'));
    const str = JSON.stringify(wb);
    const hasCount = str.includes('task-count-panel') || (str.includes('summarize') && str.includes('count()'));
    const hasCost  = str.includes('cost-estimation-panel') || str.includes('EstimatedCost') || str.includes('ConsumptionRate');
    process.stdout.write((hasCount && hasCost) ? 'yes' : 'no');
  } catch(e) { process.stdout.write('no'); }
" 2>/dev/null)
if [[ "$WORKBOOK_PANELS" == "yes" ]]; then
  pass "Workbook contains both task-count and cost-estimation panels"
else
  fail "Workbook is missing one or both required panels (task-count, cost-estimation)"
fi

# ---------------------------------------------------------------------------
# Check 13: Deploy script --dry-run runs without error (offline self-test)
# ---------------------------------------------------------------------------
echo "--- Check 13: Deploy script --dry-run executes without error ---"
DRY_RUN_OUTPUT=$(bash "scripts/deploy-monitoring.sh" --email "test@example.com" --dry-run 2>&1)
DRY_RUN_EXIT=$?
if [[ "$DRY_RUN_EXIT" -eq 0 ]]; then
  pass "scripts/deploy-monitoring.sh --dry-run exits 0"
else
  fail "scripts/deploy-monitoring.sh --dry-run failed (exit $DRY_RUN_EXIT)"
fi

# ---------------------------------------------------------------------------
# Live checks (--live only) — require Azure credentials
# ---------------------------------------------------------------------------
echo ""
echo "--- Live checks (requires --live flag and az login) ---"
if [[ "$LIVE" == "true" ]]; then
  # L1: Action group exists
  if az monitor action-group show \
       --resource-group "rg-avd-dev-eastus" \
       --name "ag-optio-alerts" \
       --query "name" -o tsv 2>/dev/null | grep -q "ag-optio-alerts"; then
    pass "[LIVE] Action group 'ag-optio-alerts' exists in rg-avd-dev-eastus"
  else
    fail "[LIVE] Action group 'ag-optio-alerts' not found in rg-avd-dev-eastus"
  fi

  # L2: Metric alert rule exists
  if az monitor metrics alert show \
       --resource-group "rg-avd-dev-eastus" \
       --name "alert-optio-job-failure" \
       --query "name" -o tsv 2>/dev/null | grep -q "alert-optio-job-failure"; then
    pass "[LIVE] Metric alert rule 'alert-optio-job-failure' exists in rg-avd-dev-eastus"
  else
    fail "[LIVE] Metric alert rule 'alert-optio-job-failure' not found in rg-avd-dev-eastus"
  fi
else
  skip "Live Azure checks skipped (re-run with --live to execute)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " M003/S02 Verification Summary"
echo "============================================"
echo "  Passed : $PASS"
echo "  Failed : $FAIL"
echo "  Skipped: $SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL check(s) failed."
  exit 1
else
  echo ""
  echo "RESULT: PASS — All $PASS checks passed, $SKIP skipped."
  exit 0
fi
