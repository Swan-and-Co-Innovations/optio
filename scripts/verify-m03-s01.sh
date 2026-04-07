#!/usr/bin/env bash
# verify-m03-s01.sh — Offline verification for M003/S01 (GitHub Actions OIDC workflow)
#
# All offline checks are file-based (no Azure CLI calls, no network) so they pass in CI
# without Azure credentials.  Pass --live to also run live checks (requires az login).
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

echo "=== M003/S01 Offline Verification ==="
echo ""

# ---------------------------------------------------------------------------
# Check 1: Workflow file exists
# ---------------------------------------------------------------------------
echo "--- Check 1: workflow file exists ---"
if test -f ".github/workflows/build-deploy.yml"; then
  pass ".github/workflows/build-deploy.yml exists"
else
  fail ".github/workflows/build-deploy.yml missing"
fi

# ---------------------------------------------------------------------------
# Check 2: Workflow YAML is syntactically valid (node -e, not jq)
# ---------------------------------------------------------------------------
echo "--- Check 2: workflow YAML syntax (node yaml) ---"
if node -e "
  const yaml = require('yaml');
  const fs   = require('fs');
  const src  = fs.readFileSync('.github/workflows/build-deploy.yml', 'utf8');
  yaml.parse(src);
" 2>/dev/null; then
  pass "Workflow YAML is syntactically valid"
else
  fail "Workflow YAML failed to parse (check node yaml output)"
fi

# ---------------------------------------------------------------------------
# Check 3: Trigger is push to main
# ---------------------------------------------------------------------------
echo "--- Check 3: push-to-main trigger ---"
TRIGGER_OK=$(node -e "
  const yaml = require('yaml');
  const fs   = require('fs');
  try {
    const doc = yaml.parse(fs.readFileSync('.github/workflows/build-deploy.yml', 'utf8'));
    const branches = doc.on && doc.on.push && doc.on.push.branches || [];
    process.stdout.write(branches.includes('main') ? 'yes' : 'no');
  } catch(e) { process.stdout.write('no'); }
" 2>/dev/null)
if [[ "$TRIGGER_OK" == "yes" ]]; then
  pass "Workflow triggers on push to main"
else
  fail "Workflow push-to-main trigger not configured correctly"
fi

# ---------------------------------------------------------------------------
# Check 4: id-token: write permission declared (required for OIDC)
# ---------------------------------------------------------------------------
echo "--- Check 4: id-token write permission ---"
if grep -q "id-token: write" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "id-token: write permission present"
else
  fail "id-token: write permission missing"
fi

# ---------------------------------------------------------------------------
# Check 5: azure/login OIDC step present
# ---------------------------------------------------------------------------
echo "--- Check 5: azure/login OIDC step ---"
if grep -q "azure/login" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "azure/login step found in workflow"
else
  fail "azure/login step NOT found in workflow"
fi

# ---------------------------------------------------------------------------
# Check 6: az acr build step present
# ---------------------------------------------------------------------------
echo "--- Check 6: az acr build step ---"
if grep -q "az acr build" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "az acr build step found in workflow"
else
  fail "az acr build step NOT found in workflow"
fi

# ---------------------------------------------------------------------------
# Check 7: ACR registry name in workflow matches aca-job-template.json
# ---------------------------------------------------------------------------
echo "--- Check 7: ACR registry name cross-reference ---"
ACR_IN_WORKFLOW=$(grep "acrdevd2thdvq46mgnw" ".github/workflows/build-deploy.yml" 2>/dev/null | head -1)
ACR_IN_TEMPLATE=$(grep "acrdevd2thdvq46mgnw" "scripts/aca-job-template.json" 2>/dev/null | head -1)
if [[ -n "$ACR_IN_WORKFLOW" && -n "$ACR_IN_TEMPLATE" ]]; then
  pass "ACR name 'acrdevd2thdvq46mgnw' consistent across workflow and aca-job-template.json"
else
  fail "ACR name mismatch: workflow='${ACR_IN_WORKFLOW:-<not found>}' template='${ACR_IN_TEMPLATE:-<not found>}'"
fi

# ---------------------------------------------------------------------------
# Check 8: github.sha used for image tag
# ---------------------------------------------------------------------------
echo "--- Check 8: git SHA image tag ---"
if grep -q "github.sha" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "github.sha used for image tag"
else
  fail "github.sha NOT used for image tag"
fi

# ---------------------------------------------------------------------------
# Check 9: az containerapp update step present
# ---------------------------------------------------------------------------
echo "--- Check 9: az containerapp update step ---"
if grep -q "az containerapp" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "az containerapp step found in workflow"
else
  fail "az containerapp step NOT found in workflow"
fi

# ---------------------------------------------------------------------------
# Check 10: Resource group matches rg-avd-dev-eastus in workflow
# ---------------------------------------------------------------------------
echo "--- Check 10: resource group name in workflow ---"
if grep -q "rg-avd-dev-eastus" ".github/workflows/build-deploy.yml" 2>/dev/null; then
  pass "Resource group rg-avd-dev-eastus found in workflow"
else
  fail "Resource group rg-avd-dev-eastus NOT found in workflow"
fi

# ---------------------------------------------------------------------------
# Check 11: Resource group consistent between workflow and aca-job-template.json
# ---------------------------------------------------------------------------
echo "--- Check 11: resource group cross-reference ---"
RG_IN_WORKFLOW=$(grep "rg-avd-dev-eastus" ".github/workflows/build-deploy.yml" 2>/dev/null | head -1)
RG_IN_TEMPLATE=$(grep "rg-avd-dev-eastus" "scripts/aca-job-template.json" 2>/dev/null | head -1)
if [[ -n "$RG_IN_WORKFLOW" && -n "$RG_IN_TEMPLATE" ]]; then
  pass "Resource group 'rg-avd-dev-eastus' consistent across workflow and aca-job-template.json"
else
  fail "Resource group mismatch: workflow='${RG_IN_WORKFLOW:-<not found>}' template='${RG_IN_TEMPLATE:-<not found>}'"
fi

# ---------------------------------------------------------------------------
# Check 12: scripts/setup-oidc.sh exists
# ---------------------------------------------------------------------------
echo "--- Check 12: setup-oidc.sh exists ---"
if test -f "scripts/setup-oidc.sh"; then
  pass "scripts/setup-oidc.sh exists"
else
  fail "scripts/setup-oidc.sh missing"
fi

# ---------------------------------------------------------------------------
# Check 13: scripts/setup-oidc.sh has valid bash syntax
# ---------------------------------------------------------------------------
echo "--- Check 13: setup-oidc.sh bash syntax ---"
if bash -n "scripts/setup-oidc.sh" 2>/dev/null; then
  pass "scripts/setup-oidc.sh has valid bash syntax"
else
  fail "scripts/setup-oidc.sh has bash syntax errors"
fi

# ---------------------------------------------------------------------------
# Live checks (--live only) — require Azure credentials
# ---------------------------------------------------------------------------
echo ""
echo "--- Live checks (requires --live flag and az login) ---"
if [[ "$LIVE" == "true" ]]; then
  # L1: Verify ACA job exists in Azure
  if az containerapp job show \
       --name "optio-agent-job" \
       --resource-group "rg-avd-dev-eastus" \
       --query "name" -o tsv 2>/dev/null | grep -q "optio-agent-job"; then
    pass "[LIVE] ACA job 'optio-agent-job' exists in rg-avd-dev-eastus"
  else
    fail "[LIVE] ACA job 'optio-agent-job' not found in rg-avd-dev-eastus"
  fi

  # L2: Verify ACR repository exists
  if az acr repository list \
       --name "acrdevd2thdvq46mgnw" \
       --query "[?@=='gsd-agent']" -o tsv 2>/dev/null | grep -q "gsd-agent"; then
    pass "[LIVE] ACR repository 'gsd-agent' exists in acrdevd2thdvq46mgnw"
  else
    fail "[LIVE] ACR repository 'gsd-agent' not found in acrdevd2thdvq46mgnw"
  fi
else
  skip "Live Azure checks skipped (re-run with --live to execute)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " M003/S01 Verification Summary"
echo "============================================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
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
