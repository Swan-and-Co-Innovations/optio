#!/usr/bin/env bash
# setup-oidc.sh — One-time OIDC federated credential setup for GitHub Actions → Azure
#
# Run this script ONCE with an identity that has Owner (or Contributor + User Access Admin)
# on the Azure subscription.  It provisions the service principal, federated credential,
# and role assignments that allow GitHub Actions to authenticate via OIDC — no stored
# client secrets.
#
# Prerequisites:
#   - az CLI installed and logged in (az login)
#   - Owner or Contributor + User Access Admin on the target subscription
#   - jq installed (used for JSON parsing)
#
# After running this script, add the three output values as GitHub repository secrets:
#   AZURE_CLIENT_ID       — the service principal app (client) ID
#   AZURE_TENANT_ID       — your Azure AD tenant ID
#   AZURE_SUBSCRIPTION_ID — your Azure subscription ID
#
# The GitHub Actions workflow references these secrets for azure/login@v2 OIDC auth.
#
# Usage:
#   bash scripts/setup-oidc.sh [--subscription <id>] [--repo <owner/repo>] [--dry-run]
#
#   --subscription  Azure subscription ID (default: active az account)
#   --repo          GitHub repository in owner/repo format (default: reads from git remote)
#   --dry-run       Print commands without executing them
#
# Exit codes:
#   0 — success
#   1 — failure

set -uo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SUBSCRIPTION_ID=""
GITHUB_REPO=""
DRY_RUN=false

SP_NAME="sp-github-actions-optio"
RESOURCE_GROUP="rg-avd-dev-eastus"
ACR_NAME="acrdevd2thdvq46mgnw"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --subscription) SUBSCRIPTION_ID="$2"; shift 2 ;;
    --repo)         GITHUB_REPO="$2";     shift 2 ;;
    --dry-run)      DRY_RUN=true;         shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/setup-oidc.sh [--subscription <id>] [--repo <owner/repo>] [--dry-run]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[oidc-setup] $*"; }
err()  { echo "[oidc-setup] ERROR: $*" >&2; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# ---------------------------------------------------------------------------
# Resolve subscription
# ---------------------------------------------------------------------------
if [[ -z "$SUBSCRIPTION_ID" ]]; then
  SUBSCRIPTION_ID=$(az account show --query "id" -o tsv 2>/dev/null || true)
  if [[ -z "$SUBSCRIPTION_ID" ]]; then
    err "No subscription found. Run 'az login' first or pass --subscription."
    exit 1
  fi
fi
log "Using subscription: $SUBSCRIPTION_ID"

TENANT_ID=$(az account show --subscription "$SUBSCRIPTION_ID" --query "tenantId" -o tsv 2>/dev/null)
log "Tenant ID:          $TENANT_ID"

# ---------------------------------------------------------------------------
# Resolve GitHub repo
# ---------------------------------------------------------------------------
if [[ -z "$GITHUB_REPO" ]]; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  # Extract owner/repo from SSH (git@github.com:owner/repo.git) or HTTPS
  GITHUB_REPO=$(echo "$REMOTE_URL" \
    | sed -E 's|.*github\.com[:/]([^/]+/[^/]+)(\.git)?$|\1|')
fi

if [[ -z "$GITHUB_REPO" || "$GITHUB_REPO" == "$REMOTE_URL" ]]; then
  err "Could not determine GitHub repository. Pass --repo owner/repo explicitly."
  exit 1
fi
log "GitHub repository:  $GITHUB_REPO"

GITHUB_ORG="${GITHUB_REPO%%/*}"
GITHUB_REPO_NAME="${GITHUB_REPO##*/}"

# ---------------------------------------------------------------------------
# Step 1: Create service principal
# ---------------------------------------------------------------------------
log ""
log "=== Step 1: Create service principal '$SP_NAME' ==="

EXISTING_SP=$(az ad sp list --display-name "$SP_NAME" --query "[0].appId" -o tsv 2>/dev/null || true)

if [[ -n "$EXISTING_SP" ]]; then
  log "  Service principal already exists (appId: $EXISTING_SP). Skipping creation."
  CLIENT_ID="$EXISTING_SP"
else
  log "  Creating service principal ..."
  SP_JSON=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --skip-assignment \
    --output json 2>/dev/null)
  CLIENT_ID=$(echo "$SP_JSON" | jq -r '.appId')
  log "  Created service principal (appId: $CLIENT_ID)"
fi

# Retrieve the underlying app object ID (needed for federated credential API)
APP_OBJECT_ID=$(az ad app show --id "$CLIENT_ID" --query "id" -o tsv 2>/dev/null)
log "  App object ID: $APP_OBJECT_ID"

# ---------------------------------------------------------------------------
# Step 2: Add OIDC federated credential for push to main
# ---------------------------------------------------------------------------
log ""
log "=== Step 2: Add federated credential for push to main ==="

FEDERATED_CRED_NAME="github-actions-main"
SUBJECT="repo:${GITHUB_REPO}:ref:refs/heads/main"

EXISTING_CRED=$(az ad app federated-credential list \
  --id "$APP_OBJECT_ID" \
  --query "[?name=='$FEDERATED_CRED_NAME'].name | [0]" -o tsv 2>/dev/null || true)

if [[ -n "$EXISTING_CRED" ]]; then
  log "  Federated credential '$FEDERATED_CRED_NAME' already exists. Skipping."
else
  log "  Creating federated credential (subject: $SUBJECT) ..."
  run "az ad app federated-credential create \
    --id '$APP_OBJECT_ID' \
    --parameters '{
      \"name\": \"$FEDERATED_CRED_NAME\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"$SUBJECT\",
      \"description\": \"GitHub Actions OIDC for push to main\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }'"
  log "  Federated credential created."
fi

# ---------------------------------------------------------------------------
# Step 3: Assign ACR push role
# ---------------------------------------------------------------------------
log ""
log "=== Step 3: Assign AcrPush role on ACR '$ACR_NAME' ==="

ACR_RESOURCE_ID=$(az acr show \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "id" -o tsv 2>/dev/null || true)

if [[ -z "$ACR_RESOURCE_ID" ]]; then
  err "Could not resolve ACR resource ID for '$ACR_NAME' in '$RESOURCE_GROUP'."
  err "Ensure the ACR exists and you have Reader access."
  exit 1
fi

EXISTING_ACR_ROLE=$(az role assignment list \
  --assignee "$CLIENT_ID" \
  --scope "$ACR_RESOURCE_ID" \
  --role "AcrPush" \
  --query "[0].id" -o tsv 2>/dev/null || true)

if [[ -n "$EXISTING_ACR_ROLE" ]]; then
  log "  AcrPush role already assigned. Skipping."
else
  log "  Assigning AcrPush role ..."
  run "az role assignment create \
    --assignee '$CLIENT_ID' \
    --role 'AcrPush' \
    --scope '$ACR_RESOURCE_ID'"
  log "  AcrPush role assigned."
fi

# ---------------------------------------------------------------------------
# Step 4: Assign Contributor role on the Resource Group (for ACA job update)
# ---------------------------------------------------------------------------
log ""
log "=== Step 4: Assign Contributor role on resource group '$RESOURCE_GROUP' ==="

RG_RESOURCE_ID=$(az group show \
  --name "$RESOURCE_GROUP" \
  --query "id" -o tsv 2>/dev/null || true)

if [[ -z "$RG_RESOURCE_ID" ]]; then
  err "Resource group '$RESOURCE_GROUP' not found."
  exit 1
fi

EXISTING_RG_ROLE=$(az role assignment list \
  --assignee "$CLIENT_ID" \
  --scope "$RG_RESOURCE_ID" \
  --role "Contributor" \
  --query "[0].id" -o tsv 2>/dev/null || true)

if [[ -n "$EXISTING_RG_ROLE" ]]; then
  log "  Contributor role on RG already assigned. Skipping."
else
  log "  Assigning Contributor role on RG ..."
  run "az role assignment create \
    --assignee '$CLIENT_ID' \
    --role 'Contributor' \
    --scope '$RG_RESOURCE_ID'"
  log "  Contributor role assigned."
fi

# ---------------------------------------------------------------------------
# Step 5: Print GitHub secrets to configure
# ---------------------------------------------------------------------------
log ""
log "=== Step 5: GitHub repository secrets to configure ==="
echo ""
echo "Add the following secrets to the GitHub repository:"
echo "  https://github.com/${GITHUB_REPO}/settings/secrets/actions"
echo ""
echo "  Secret name              Value"
echo "  -----------------------  ----------------------------------------"
echo "  AZURE_CLIENT_ID          ${CLIENT_ID}"
echo "  AZURE_TENANT_ID          ${TENANT_ID}"
echo "  AZURE_SUBSCRIPTION_ID    ${SUBSCRIPTION_ID}"
echo ""
echo "These are NOT sensitive credentials — they are public identifiers."
echo "The OIDC trust is enforced by the federated credential subject claim:"
echo "  $SUBJECT"
echo ""

log "OIDC setup complete."
