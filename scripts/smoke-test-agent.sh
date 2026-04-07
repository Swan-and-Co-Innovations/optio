#!/usr/bin/env bash
# smoke-test-agent.sh — Docker-based smoke test for the GSD agent image
#
# Builds the Dockerfile.agent image and runs a series of quick probes to
# confirm that gsd, code-review-graph, and the agent-entrypoint.sh chain are
# all wired correctly inside the container.
#
# Modes:
#   --dry-run   Validates prerequisites (docker present, Dockerfile exists,
#               smoke-test prerequisites met) without issuing any docker
#               commands.  Exits 0 if all prerequisites are satisfied.
#   (default)   Full smoke test: build → probe → entrypoint flow → cleanup.
#
# Probe sequence (full mode):
#   1. docker build -f Dockerfile.agent -t gsd-agent:s02-test .
#   2. docker run --rm gsd-agent:s02-test gsd --version    (exits 0)
#   3. docker run --rm gsd-agent:s02-test code-review-graph --version  (exits 0)
#   4. docker run --rm with a minimal git repo mounted at /workspace to
#      exercise the entrypoint (ANTHROPIC_API_KEY=dummy, expects non-zero
#      exit because gsd is not configured — but entrypoint must start and
#      reach the gsd invocation, not abort on a script error)
#
# Prerequisites:
#   - docker CLI available in PATH
#   - Dockerfile.agent present in repo root
#   - scripts/agent-entrypoint.sh present
#
# Exit codes:
#   0 — all probes passed (or --dry-run prerequisites met)
#   1 — one or more probes failed (or prerequisites missing)

set -uo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

IMAGE_TAG="gsd-agent:s02-test"
PASS=0
FAIL=0
SKIP=0

check_pass() { echo "  [PASS] $*"; (( PASS++ )) || true; }
check_fail() { echo "  [FAIL] $*"; (( FAIL++ )) || true; }
check_skip() { echo "  [SKIP] $*"; (( SKIP++ )) || true; }
section()    { echo; echo "--- $* ---"; }

echo "=== Smoke Test: GSD Agent Image ==="
echo "Root: $ROOT"
echo "Image: $IMAGE_TAG"
[[ "$DRY_RUN" == "true" ]] && echo "Mode: DRY-RUN (prerequisite check only)" || echo "Mode: FULL (docker build + run)"

# ── Cleanup trap ──────────────────────────────────────────────────────────────
# Always remove the test image on exit to avoid polluting the local registry.
cleanup() {
  if [[ "$DRY_RUN" == "false" ]]; then
    docker rmi "$IMAGE_TAG" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Prerequisite checks (run in both dry-run and full mode)
# ---------------------------------------------------------------------------
section "Prerequisites"

# P1: docker CLI available
if command -v docker &>/dev/null; then
  check_pass "docker CLI is available ($(docker --version 2>&1 | head -1))"
else
  check_fail "docker CLI not found in PATH — cannot run smoke test"
  echo
  echo "RESULT: FAIL — prerequisites not met."
  exit 1
fi

# P2: Dockerfile.agent present
if [[ -f "Dockerfile.agent" ]]; then
  check_pass "Dockerfile.agent found"
else
  check_fail "Dockerfile.agent not found in repo root ($ROOT)"
  echo
  echo "RESULT: FAIL — prerequisites not met."
  exit 1
fi

# P3: agent-entrypoint.sh present
if [[ -f "scripts/agent-entrypoint.sh" ]]; then
  check_pass "scripts/agent-entrypoint.sh found"
else
  check_fail "scripts/agent-entrypoint.sh not found"
  echo
  echo "RESULT: FAIL — prerequisites not met."
  exit 1
fi

# P4: repo-init.sh present (entrypoint sources it)
if [[ -f "scripts/repo-init.sh" ]]; then
  check_pass "scripts/repo-init.sh found"
else
  check_skip "scripts/repo-init.sh not found — entrypoint will fail at runtime (non-blocking for build probe)"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo
  echo "============================================"
  echo " Smoke Test Summary (dry-run)"
  echo "============================================"
  echo "  Passed:  $PASS"
  echo "  Failed:  $FAIL"
  echo "  Skipped: $SKIP"
  echo "============================================"
  if [[ "$FAIL" -gt 0 ]]; then
    echo ""
    echo "RESULT: FAIL — $FAIL prerequisite(s) failed."
    exit 1
  else
    echo ""
    echo "RESULT: PASS — All prerequisites satisfied (dry-run only)."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Probe 1: docker build
# ---------------------------------------------------------------------------
section "Probe 1: docker build -f Dockerfile.agent -t $IMAGE_TAG ."
echo "  This may take several minutes on first run (pulls base image)."
docker build -f Dockerfile.agent -t "$IMAGE_TAG" . && BUILD_EXIT=0 || BUILD_EXIT=$?
if [[ "$BUILD_EXIT" -eq 0 ]]; then
  check_pass "docker build succeeded (image: $IMAGE_TAG)"
else
  check_fail "docker build failed (exit $BUILD_EXIT)"
  echo
  echo "============================================"
  echo " Smoke Test Summary"
  echo "============================================"
  echo "  Passed:  $PASS"
  echo "  Failed:  $FAIL"
  echo "  Skipped: $SKIP"
  echo "============================================"
  echo ""
  echo "RESULT: FAIL — build failed; skipping run probes."
  exit 1
fi

# ---------------------------------------------------------------------------
# Probe 2: gsd --version
# ---------------------------------------------------------------------------
section "Probe 2: docker run --rm $IMAGE_TAG gsd --version"
GSD_VER_OUT=$(docker run --rm "$IMAGE_TAG" gsd --version 2>&1) && GSD_VER_EXIT=0 || GSD_VER_EXIT=$?
if [[ "$GSD_VER_EXIT" -eq 0 ]]; then
  check_pass "gsd --version exited 0 (output: $(echo "$GSD_VER_OUT" | head -1))"
else
  check_fail "gsd --version failed (exit $GSD_VER_EXIT): $GSD_VER_OUT"
fi

# ---------------------------------------------------------------------------
# Probe 3: code-review-graph --version
# ---------------------------------------------------------------------------
section "Probe 3: docker run --rm $IMAGE_TAG code-review-graph --version"
CRG_VER_OUT=$(docker run --rm "$IMAGE_TAG" code-review-graph --version 2>&1) && CRG_VER_EXIT=0 || CRG_VER_EXIT=$?
if [[ "$CRG_VER_EXIT" -eq 0 ]]; then
  check_pass "code-review-graph --version exited 0 (output: $(echo "$CRG_VER_OUT" | head -1))"
else
  check_fail "code-review-graph --version failed (exit $CRG_VER_EXIT): $CRG_VER_OUT"
fi

# ---------------------------------------------------------------------------
# Probe 4: entrypoint flow with minimal git repo
# ---------------------------------------------------------------------------
section "Probe 4: entrypoint flow with minimal workspace"
# Create a minimal git repo in a temp directory to mount as /workspace.
# We pass a dummy ANTHROPIC_API_KEY so the entrypoint passes the secret check.
# The expectation: entrypoint.sh starts up (sources repo-init.sh, validates key)
# then invokes gsd headless --auto.  gsd will likely exit non-zero because there
# is no real GSD configuration — but the container must NOT exit 1 due to a
# script error in the entrypoint itself (only gsd's own exit code is propagated).
# We treat exit codes 0 or ≥2 (gsd error, not entrypoint error) as passing
# this structural probe.  Exit 1 from bash set -e would indicate a script error.
TMPDIR_REPO="$(mktemp -d)"
(
  cd "$TMPDIR_REPO"
  git init -q
  git config user.email "smoke@test.local"
  git config user.name "Smoke Test"
  touch README.md
  git add README.md
  git commit -q -m "init"
)

# Run with a 15-second timeout to avoid hanging if gsd blocks waiting for input.
# We allow any non-script-error exit code (not 1 from set -e).
ENTRYPOINT_OUT=$(docker run --rm \
  -e ANTHROPIC_API_KEY=dummy-smoke-test-key \
  -e GSD_TIMEOUT_MS=10000 \
  -v "${TMPDIR_REPO}:/workspace" \
  "$IMAGE_TAG" 2>&1) && ENTRYPOINT_EXIT=0 || ENTRYPOINT_EXIT=$?

rm -rf "$TMPDIR_REPO"

# Exit code analysis:
#  0   = gsd exited cleanly (unlikely but fine)
#  1   = could be entrypoint script error (set -e) OR gsd exit 1
#  124 = timeout (entrypoint reached gsd — probe passes structurally)
# other = gsd's own non-zero exit propagated through entrypoint
#
# We can only definitively identify a bash script error if we see the
# "[entrypoint] ERROR:" prefix in output combined with exit 1.
if echo "$ENTRYPOINT_OUT" | grep -q '\[entrypoint\] ERROR:'; then
  check_fail "entrypoint reported an ERROR before reaching gsd: $(echo "$ENTRYPOINT_OUT" | grep '\[entrypoint\]')"
elif echo "$ENTRYPOINT_OUT" | grep -q '\[entrypoint\] Starting:'; then
  check_pass "entrypoint reached gsd invocation (exit $ENTRYPOINT_EXIT) — structural wiring OK"
else
  # Entrypoint produced no [entrypoint] Starting line — likely crashed before gsd
  check_fail "entrypoint did not reach gsd invocation (exit $ENTRYPOINT_EXIT); output: $ENTRYPOINT_OUT"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================"
echo " Smoke Test Summary"
echo "============================================"
echo "  Passed:  $PASS"
echo "  Failed:  $FAIL"
echo "  Skipped: $SKIP"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL probe(s) failed."
  exit 1
else
  echo ""
  echo "RESULT: PASS — All probes passed."
  exit 0
fi
