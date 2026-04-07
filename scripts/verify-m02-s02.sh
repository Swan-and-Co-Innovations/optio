#!/usr/bin/env bash
# verify-m02-s02.sh — Verification harness for M002/S02 success criteria
#
# Checks:
#   1. packages/agent-adapter-gsd/package.json exists and is valid JSON
#   2. packages/agent-adapter-gsd/tsconfig.json exists and is valid JSON
#   3. npx tsc --noEmit succeeds in packages/agent-adapter-gsd/
#   4. runGsdHeadless export exists in src/index.ts
#   5. scripts/agent-entrypoint.sh passes bash -n syntax check
#   6. scripts/agent-entrypoint.sh references repo-init.sh
#   7. Dockerfile.agent references agent-entrypoint.sh as ENTRYPOINT
#   8. No secret logging in agent-entrypoint.sh
#   [LIVE] Docker build + run (only with --live flag)
#
# Usage:
#   bash scripts/verify-m02-s02.sh           # offline checks only
#   bash scripts/verify-m02-s02.sh --live    # includes docker build/run checks
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

echo "=== M002/S02 Verification ==="
echo "Root: $ROOT"
[[ "$LIVE" == "true" ]] && echo "Mode: LIVE (docker checks enabled)" || echo "Mode: OFFLINE (static checks only)"

# ---------------------------------------------------------------------------
# Check 1: packages/agent-adapter-gsd/package.json exists and valid JSON
# ---------------------------------------------------------------------------
section "Check 1: packages/agent-adapter-gsd/package.json"
PKG_JSON="packages/agent-adapter-gsd/package.json"
if [[ -f "$PKG_JSON" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$PKG_JSON','utf8'))" 2>/dev/null; then
    check_pass "packages/agent-adapter-gsd/package.json exists and is valid JSON"
  else
    check_fail "packages/agent-adapter-gsd/package.json exists but is not valid JSON"
  fi
else
  check_fail "packages/agent-adapter-gsd/package.json not found"
fi

# ---------------------------------------------------------------------------
# Check 2: packages/agent-adapter-gsd/tsconfig.json exists and valid JSON
# ---------------------------------------------------------------------------
section "Check 2: packages/agent-adapter-gsd/tsconfig.json"
TSCONFIG="packages/agent-adapter-gsd/tsconfig.json"
if [[ -f "$TSCONFIG" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$TSCONFIG','utf8'))" 2>/dev/null; then
    check_pass "packages/agent-adapter-gsd/tsconfig.json exists and is valid JSON"
  else
    check_fail "packages/agent-adapter-gsd/tsconfig.json exists but is not valid JSON"
  fi
else
  check_fail "packages/agent-adapter-gsd/tsconfig.json not found"
fi

# ---------------------------------------------------------------------------
# Check 3: TypeScript compiles without errors
# ---------------------------------------------------------------------------
section "Check 3: npx tsc --noEmit in packages/agent-adapter-gsd/"
PKG_DIR="packages/agent-adapter-gsd"
if [[ -d "$PKG_DIR/node_modules" ]]; then
  TSC_OUTPUT=$(cd "$PKG_DIR" && npx tsc --noEmit 2>&1) && TSC_EXIT=0 || TSC_EXIT=$?
  if [[ "$TSC_EXIT" -eq 0 ]]; then
    check_pass "npx tsc --noEmit passed — no TypeScript errors"
  else
    check_fail "npx tsc --noEmit failed (exit $TSC_EXIT): $TSC_OUTPUT"
  fi
else
  check_skip "node_modules not found in packages/agent-adapter-gsd/ — run npm install first"
fi

# ---------------------------------------------------------------------------
# Check 4: src/index.ts exports runGsdHeadless
# ---------------------------------------------------------------------------
section "Check 4: src/index.ts exports runGsdHeadless"
INDEX_TS="packages/agent-adapter-gsd/src/index.ts"
if [[ -f "$INDEX_TS" ]]; then
  if grep -q 'export.*runGsdHeadless\|export async function runGsdHeadless' "$INDEX_TS"; then
    check_pass "src/index.ts exports runGsdHeadless"
  else
    check_fail "src/index.ts does not export runGsdHeadless"
  fi
else
  check_fail "packages/agent-adapter-gsd/src/index.ts not found"
fi

# ---------------------------------------------------------------------------
# Check 5: scripts/agent-entrypoint.sh passes bash -n syntax check
# ---------------------------------------------------------------------------
section "Check 5: scripts/agent-entrypoint.sh bash -n syntax check"
ENTRYPOINT_SH="scripts/agent-entrypoint.sh"
if [[ -f "$ENTRYPOINT_SH" ]]; then
  if command -v bash &>/dev/null; then
    BASH_N_OUT=$(bash -n "$ENTRYPOINT_SH" 2>&1) && BASH_N_EXIT=0 || BASH_N_EXIT=$?
    if [[ "$BASH_N_EXIT" -eq 0 ]]; then
      check_pass "scripts/agent-entrypoint.sh passes bash -n syntax check"
    else
      check_fail "scripts/agent-entrypoint.sh failed bash -n: $BASH_N_OUT"
    fi
  else
    check_skip "bash not available — skipping syntax check"
  fi
else
  check_fail "scripts/agent-entrypoint.sh not found"
fi

# ---------------------------------------------------------------------------
# Check 6: scripts/agent-entrypoint.sh references repo-init.sh
# ---------------------------------------------------------------------------
section "Check 6: scripts/agent-entrypoint.sh references repo-init.sh"
if [[ -f "$ENTRYPOINT_SH" ]]; then
  if grep -q 'repo-init.sh' "$ENTRYPOINT_SH"; then
    check_pass "scripts/agent-entrypoint.sh references repo-init.sh"
  else
    check_fail "scripts/agent-entrypoint.sh does not reference repo-init.sh"
  fi
else
  check_fail "scripts/agent-entrypoint.sh not found"
fi

# ---------------------------------------------------------------------------
# Check 7: Dockerfile.agent references agent-entrypoint.sh as ENTRYPOINT
# ---------------------------------------------------------------------------
section "Check 7: Dockerfile.agent ENTRYPOINT references agent-entrypoint.sh"
DOCKERFILE="Dockerfile.agent"
if [[ -f "$DOCKERFILE" ]]; then
  if grep -q 'agent-entrypoint.sh' "$DOCKERFILE"; then
    check_pass "Dockerfile.agent references agent-entrypoint.sh"
  else
    check_fail "Dockerfile.agent does not reference agent-entrypoint.sh"
  fi
else
  check_fail "Dockerfile.agent not found"
fi

# ---------------------------------------------------------------------------
# Check 8: No secret logging in agent-entrypoint.sh
# ---------------------------------------------------------------------------
section "Check 8: No echo of ANTHROPIC secret in agent-entrypoint.sh"
if [[ -f "$ENTRYPOINT_SH" ]]; then
  if grep -q 'echo.*ANTHROPIC' "$ENTRYPOINT_SH"; then
    check_fail "scripts/agent-entrypoint.sh contains 'echo.*ANTHROPIC' — potential secret logging"
  else
    check_pass "scripts/agent-entrypoint.sh contains no 'echo.*ANTHROPIC' — no secret logging"
  fi
else
  check_fail "scripts/agent-entrypoint.sh not found"
fi

# ---------------------------------------------------------------------------
# Check 9 (--live only): Docker build + run smoke test
# ---------------------------------------------------------------------------
section "Check 9: Docker build + run smoke test (live)"
if [[ "$LIVE" == "true" ]]; then
  if command -v docker &>/dev/null; then
    echo "  Building docker image gsd-agent:s02-test ..."
    docker build -f Dockerfile.agent -t gsd-agent:s02-test . && BUILD_EXIT=0 || BUILD_EXIT=$?
    if [[ "$BUILD_EXIT" -ne 0 ]]; then
      check_fail "docker build failed (exit $BUILD_EXIT)"
    else
      echo "  Running: docker run --rm gsd-agent:s02-test gsd --version"
      docker run --rm gsd-agent:s02-test gsd --version && RUN_EXIT=0 || RUN_EXIT=$?
      if [[ "$RUN_EXIT" -eq 0 ]]; then
        check_pass "docker run gsd --version exited 0"
      else
        check_fail "docker run gsd --version failed (exit $RUN_EXIT)"
      fi
      # Cleanup
      docker rmi gsd-agent:s02-test >/dev/null 2>&1 || true
    fi
  else
    check_skip "docker not available — skipping live docker check"
  fi
else
  check_skip "Live docker build/run — pass --live flag to enable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================"
echo " M002/S02 Verification Summary"
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
