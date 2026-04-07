#!/usr/bin/env bash
# verify-m02-s01.sh — Verification harness for M002/S01 success criteria
#
# Checks:
#   1. packages/container-runtime-aca/package.json exists and is valid JSON
#   2. packages/container-runtime-aca/tsconfig.json exists and is valid JSON
#   3. npx tsc --noEmit succeeds in packages/container-runtime-aca/
#   4. src/aca-runtime.ts exports AcaContainerRuntime class
#   5. src/types.ts exports AcaJobConfig and ExecutionStatus interfaces
#   6. scripts/aca-job-template.json is valid JSON with required fields
#   7. scripts/test-aca-job.sh passes bash -n syntax check
#   8. (--live) bash scripts/test-aca-job.sh exits 0
#
# Usage:
#   bash scripts/verify-m02-s01.sh           # offline checks only
#   bash scripts/verify-m02-s01.sh --live    # includes live ACA Job execution
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

echo "=== M002/S01 Verification ==="
echo "Root: $ROOT"
[[ "$LIVE" == "true" ]] && echo "Mode: LIVE (Azure checks enabled)" || echo "Mode: OFFLINE (static checks only)"

# ---------------------------------------------------------------------------
# Check 1: packages/container-runtime-aca/package.json exists and valid JSON
# ---------------------------------------------------------------------------
section "Check 1: packages/container-runtime-aca/package.json"
PKG_JSON="packages/container-runtime-aca/package.json"
if [[ -f "$PKG_JSON" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$PKG_JSON','utf8'))" 2>/dev/null; then
    check_pass "packages/container-runtime-aca/package.json exists and is valid JSON"
  else
    check_fail "packages/container-runtime-aca/package.json exists but is not valid JSON"
  fi
else
  check_fail "packages/container-runtime-aca/package.json not found"
fi

# ---------------------------------------------------------------------------
# Check 2: packages/container-runtime-aca/tsconfig.json exists and valid JSON
# ---------------------------------------------------------------------------
section "Check 2: packages/container-runtime-aca/tsconfig.json"
TSCONFIG="packages/container-runtime-aca/tsconfig.json"
if [[ -f "$TSCONFIG" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$TSCONFIG','utf8'))" 2>/dev/null; then
    check_pass "packages/container-runtime-aca/tsconfig.json exists and is valid JSON"
  else
    check_fail "packages/container-runtime-aca/tsconfig.json exists but is not valid JSON"
  fi
else
  check_fail "packages/container-runtime-aca/tsconfig.json not found"
fi

# ---------------------------------------------------------------------------
# Check 3: TypeScript compiles without errors
# ---------------------------------------------------------------------------
section "Check 3: npx tsc --noEmit in packages/container-runtime-aca/"
PKG_DIR="packages/container-runtime-aca"
if [[ -d "$PKG_DIR/node_modules" ]]; then
  TSC_OUTPUT=$(cd "$PKG_DIR" && npx tsc --noEmit 2>&1) && TSC_EXIT=0 || TSC_EXIT=$?
  if [[ "$TSC_EXIT" -eq 0 ]]; then
    check_pass "npx tsc --noEmit passed — no TypeScript errors"
  else
    check_fail "npx tsc --noEmit failed (exit $TSC_EXIT): $TSC_OUTPUT"
  fi
else
  check_skip "node_modules not found in packages/container-runtime-aca/ — run npm install first"
fi

# ---------------------------------------------------------------------------
# Check 4: src/aca-runtime.ts exports AcaContainerRuntime
# ---------------------------------------------------------------------------
section "Check 4: src/aca-runtime.ts exports AcaContainerRuntime class"
ACA_RUNTIME="packages/container-runtime-aca/src/aca-runtime.ts"
if [[ -f "$ACA_RUNTIME" ]]; then
  if grep -q 'export class AcaContainerRuntime' "$ACA_RUNTIME"; then
    check_pass "src/aca-runtime.ts exports AcaContainerRuntime class"
  else
    check_fail "src/aca-runtime.ts does not export AcaContainerRuntime class"
  fi
else
  check_fail "src/aca-runtime.ts not found"
fi

# ---------------------------------------------------------------------------
# Check 5: src/types.ts exports AcaJobConfig and ExecutionStatus
# ---------------------------------------------------------------------------
section "Check 5: src/types.ts exports AcaJobConfig and ExecutionStatus"
TYPES_TS="packages/container-runtime-aca/src/types.ts"
if [[ -f "$TYPES_TS" ]]; then
  TYPES_OK=true
  if ! grep -q 'export interface AcaJobConfig' "$TYPES_TS"; then
    check_fail "src/types.ts does not export AcaJobConfig interface"
    TYPES_OK=false
  fi
  if ! grep -q 'export interface ExecutionStatus' "$TYPES_TS"; then
    check_fail "src/types.ts does not export ExecutionStatus interface"
    TYPES_OK=false
  fi
  if [[ "$TYPES_OK" == "true" ]]; then
    check_pass "src/types.ts exports AcaJobConfig and ExecutionStatus interfaces"
  fi
else
  check_fail "src/types.ts not found"
fi

# ---------------------------------------------------------------------------
# Check 6: scripts/aca-job-template.json is valid JSON with required fields
# ---------------------------------------------------------------------------
section "Check 6: scripts/aca-job-template.json is valid JSON with required fields"
TEMPLATE="scripts/aca-job-template.json"
if [[ -f "$TEMPLATE" ]]; then
  TEMPLATE_CHECK=$(node -e "
try {
  var d = JSON.parse(require('fs').readFileSync('$TEMPLATE','utf8'));
  var hasTrigger = d.configuration && d.configuration.triggerType;
  var hasContainers = d.template && d.template.containers && d.template.containers.length > 0;
  if (!hasTrigger) { process.stderr.write('missing: configuration.triggerType\n'); process.exit(1); }
  if (!hasContainers) { process.stderr.write('missing: template.containers[]\n'); process.exit(1); }
  process.stdout.write('ok:triggerType=' + d.configuration.triggerType + ',containers=' + d.template.containers.length + '\n');
} catch(e) { process.stderr.write(e.message + '\n'); process.exit(1); }
" 2>&1) && TEMPLATE_EXIT=0 || TEMPLATE_EXIT=$?
  if [[ "$TEMPLATE_EXIT" -eq 0 ]]; then
    check_pass "scripts/aca-job-template.json is valid JSON with required fields ($TEMPLATE_CHECK)"
  else
    check_fail "scripts/aca-job-template.json validation failed: $TEMPLATE_CHECK"
  fi
else
  check_fail "scripts/aca-job-template.json not found"
fi

# ---------------------------------------------------------------------------
# Check 7: scripts/test-aca-job.sh passes bash -n syntax check
# ---------------------------------------------------------------------------
section "Check 7: scripts/test-aca-job.sh bash -n syntax check"
TEST_SCRIPT="scripts/test-aca-job.sh"
if [[ -f "$TEST_SCRIPT" ]]; then
  if command -v bash &>/dev/null; then
    BASH_N_OUT=$(bash -n "$TEST_SCRIPT" 2>&1) && BASH_N_EXIT=0 || BASH_N_EXIT=$?
    if [[ "$BASH_N_EXIT" -eq 0 ]]; then
      check_pass "scripts/test-aca-job.sh passes bash -n syntax check"
    else
      check_fail "scripts/test-aca-job.sh failed bash -n: $BASH_N_OUT"
    fi
  else
    check_skip "bash not available — skipping syntax check"
  fi
else
  check_fail "scripts/test-aca-job.sh not found"
fi

# ---------------------------------------------------------------------------
# Check 8 (--live only): bash scripts/test-aca-job.sh exits 0
# ---------------------------------------------------------------------------
section "Check 8: bash scripts/test-aca-job.sh (live ACA Job execution)"
if [[ "$LIVE" == "true" ]]; then
  if [[ -f "$TEST_SCRIPT" ]]; then
    echo "  Running live ACA Job test (this may take 2-3 minutes)..."
    bash "$TEST_SCRIPT" && LIVE_EXIT=0 || LIVE_EXIT=$?
    if [[ "$LIVE_EXIT" -eq 0 ]]; then
      check_pass "bash scripts/test-aca-job.sh exited 0 — live ACA Job execution passed"
    else
      check_fail "bash scripts/test-aca-job.sh exited $LIVE_EXIT — live ACA Job execution failed"
    fi
  else
    check_fail "scripts/test-aca-job.sh not found — cannot run live check"
  fi
else
  check_skip "Live ACA Job execution — pass --live flag to enable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================"
echo " M002/S01 Verification Summary"
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
