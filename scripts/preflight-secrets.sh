#!/usr/bin/env bash
# preflight-secrets.sh — validate that all required KV secrets exist before
# attempting to create or start agent jobs.
#
# Usage:
#   ./scripts/preflight-secrets.sh            # live check (requires az login)
#   ./scripts/preflight-secrets.sh --dry-run  # print what would be checked, no az calls
#
# Exit codes:
#   0  all secrets found (or dry-run)
#   1  one or more secrets missing or check failed

set -euo pipefail

VAULT_NAME="kv-ppf-dev-eastus"

# Secrets required for agent job operation
REQUIRED_SECRETS=(
  "anthropic-api-key"
  "GITHUB-TOKEN"
  "optio-db-url"
  "optio-redis-url"
)

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# ─── Helpers ────────────────────────────────────────────────────────────────

pass()  { echo "  [PASS] $*"; }
fail()  { echo "  [FAIL] $*"; }
skip()  { echo "  [SKIP] $*"; }
info()  { echo "  [INFO] $*"; }

# ─── Az CLI auth check ───────────────────────────────────────────────────────

check_az_auth() {
  if $DRY_RUN; then
    skip "az auth check (dry-run)"
    return 0
  fi

  if ! command -v az &>/dev/null; then
    fail "az CLI not found — install Azure CLI before running preflight"
    return 1
  fi

  local signed_in
  signed_in=$(az account show --query "user.name" -o tsv 2>/dev/null || true)
  if [[ -z "$signed_in" ]]; then
    fail "Not signed in to Azure CLI — run 'az login' first"
    return 1
  fi

  pass "az CLI authenticated as: ${signed_in}"
  return 0
}

# ─── Secret existence check ──────────────────────────────────────────────────

check_secret() {
  local secret_name="$1"

  if $DRY_RUN; then
    skip "Would check: az keyvault secret show --vault-name ${VAULT_NAME} --name ${secret_name}"
    return 0
  fi

  # Use --query to get just the name; suppress value from ever appearing in output
  local result
  if az keyvault secret show \
      --vault-name "${VAULT_NAME}" \
      --name "${secret_name}" \
      --query "name" \
      -o tsv &>/dev/null; then
    pass "${secret_name}"
  else
    fail "${secret_name} — not found or inaccessible in ${VAULT_NAME}"
    return 1
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "=== Optio Agent Job — KV Secret Preflight ==="
  echo "  Vault : ${VAULT_NAME}"
  if $DRY_RUN; then
    echo "  Mode  : DRY-RUN (no az calls will be made)"
  else
    echo "  Mode  : LIVE"
  fi
  echo ""

  local failures=0

  # Check az auth first
  if ! check_az_auth; then
    (( failures++ )) || true
  fi

  echo ""
  echo "--- Checking required secrets ---"

  for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! check_secret "${secret}"; then
      (( failures++ )) || true
    fi
  done

  echo ""
  if (( failures == 0 )); then
    echo "=== PREFLIGHT PASSED — all ${#REQUIRED_SECRETS[@]} secrets verified ==="
    exit 0
  else
    echo "=== PREFLIGHT FAILED — ${failures} issue(s) detected ==="
    echo "    Resolve the above before creating agent jobs."
    exit 1
  fi
}

main "$@"
