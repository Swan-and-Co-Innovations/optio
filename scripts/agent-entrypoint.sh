#!/usr/bin/env bash
# agent-entrypoint.sh — Container entrypoint for the Optio GSD agent image
#
# Execution order:
#   1. Source repo-init.sh  — writes .gsd/preferences.md, copies mcp-defaults.json,
#                             builds code-review-graph index
#   2. Validate ANTHROPIC_API_KEY is set (abort with clear message if missing)
#   3. Run `gsd headless --auto` with an optional timeout
#   4. Log and propagate gsd's exit code
#
# Environment variables:
#   ANTHROPIC_API_KEY  — required; consumed by gsd, never logged
#   GSD_TIMEOUT_MS     — optional; milliseconds before gsd is killed (default: 600000 = 10 min)
#   REPO_PATH          — optional; workspace path forwarded to repo-init.sh (default: /workspace)
#
# Exit codes mirror gsd's exit code.  124 is returned on timeout (consistent
# with the GNU timeout(1) convention).

set -euo pipefail

REPO_PATH="${REPO_PATH:-/workspace}"
GSD_TIMEOUT_MS="${GSD_TIMEOUT_MS:-600000}"

# ── 1. Bootstrap the repo ────────────────────────────────────────────────────
echo "[entrypoint] Running repo-init.sh for ${REPO_PATH}"
# shellcheck source=/opt/agent/repo-init.sh
source /opt/agent/repo-init.sh

# ── 2. Validate required secrets ─────────────────────────────────────────────
# Existence check only — the value is never printed.
_REQUIRED_KEY="ANTHROPIC_API_KEY"
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "[entrypoint] ERROR: required secret is not set (${_REQUIRED_KEY}) — aborting" >&2
  exit 1
fi
unset _REQUIRED_KEY

# ── 3. Convert timeout from ms to seconds for the `timeout` command ──────────
GSD_TIMEOUT_S=$(( GSD_TIMEOUT_MS / 1000 ))
if [[ "${GSD_TIMEOUT_S}" -lt 1 ]]; then
  GSD_TIMEOUT_S=1
fi

echo "[entrypoint] Starting: gsd headless --auto (timeout: ${GSD_TIMEOUT_S}s)"

# ── 4. Run gsd headless --auto ───────────────────────────────────────────────
# `timeout` sends SIGTERM at GSD_TIMEOUT_S, then SIGKILL after a 5 s grace
# period.  It exits 124 if the process was killed by the timeout signal.
set +e
timeout --kill-after=5 "${GSD_TIMEOUT_S}" gsd headless --auto
GSD_EXIT=$?
set -e

# ── 5. Log and propagate ──────────────────────────────────────────────────────
if [[ "${GSD_EXIT}" -eq 124 ]]; then
  echo "[entrypoint] gsd headless timed out after ${GSD_TIMEOUT_S}s (exit 124)" >&2
else
  echo "[entrypoint] gsd headless exited with code ${GSD_EXIT}"
fi

exit "${GSD_EXIT}"
