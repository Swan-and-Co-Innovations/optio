#!/usr/bin/env bash
# repo-init.sh — Bootstrap script for GSD-2 agent inside an ACA Job container
#
# Purpose:
#   1. Write .gsd/preferences.md with git.isolation: none so GSD-2 commits only
#      and does NOT attempt to create branches or worktrees (Optio owns that).
#   2. Copy mcp-defaults.json to the location GSD-2 reads for MCP server config.
#   3. Run `code-review-graph build` to index the mounted repo so the MCP server
#      has a fresh semantic graph at job start.
#
# Expected environment:
#   REPO_PATH  — absolute path to the mounted repo (default: /workspace)
#
# Called by the ACA Job entrypoint before `gsd headless` starts.
#
# Exit codes:
#   0 — success
#   1 — fatal error (caller should abort the job)

set -euo pipefail

REPO_PATH="${REPO_PATH:-/workspace}"

echo "[repo-init] Starting agent bootstrap in ${REPO_PATH}"

# ── 1. Validate repo path ────────────────────────────────────────────────────
if [[ ! -d "${REPO_PATH}" ]]; then
  echo "[repo-init] ERROR: REPO_PATH '${REPO_PATH}' does not exist" >&2
  exit 1
fi

if [[ ! -d "${REPO_PATH}/.git" ]]; then
  echo "[repo-init] ERROR: '${REPO_PATH}' is not a git repository" >&2
  exit 1
fi

cd "${REPO_PATH}"

# ── 2. Write .gsd/preferences.md with git.isolation: none ───────────────────
# D004: GSD-2 must not create branches or worktrees — Optio manages those.
# Writing preferences.md before gsd starts is the clean injection point.
mkdir -p .gsd

cat > .gsd/preferences.md << 'PREFS'
# GSD-2 Preferences

## git

isolation: none

<!-- git.isolation: none means GSD-2 commits only. It does NOT create branches,
     worktrees, or remotes. All branch and worktree management is performed by
     Optio, which calls GSD-2 as a sub-process. See D004 in DECISIONS.md. -->
PREFS

echo "[repo-init] Wrote .gsd/preferences.md (git.isolation: none)"

# ── 3. Copy MCP defaults to GSD-2 config location ────────────────────────────
# GSD-2 (gsd-pi) reads .mcp.json at the repo root for MCP server definitions.
cp /opt/agent/mcp-defaults.json .mcp.json
echo "[repo-init] Copied mcp-defaults.json → .mcp.json"

# ── 4. Build code-review-graph index ─────────────────────────────────────────
# Indexes the repo so the MCP server can serve semantic queries immediately.
# Failure is non-fatal — agent can still run; just with degraded code-review
# capabilities. Log the error and continue.
echo "[repo-init] Running: code-review-graph build"
if code-review-graph build 2>&1; then
  echo "[repo-init] code-review-graph build complete"
else
  echo "[repo-init] WARNING: code-review-graph build failed — continuing without graph index" >&2
fi

echo "[repo-init] Bootstrap complete"
