#!/usr/bin/env bash
# deploy-optio-apps.sh — Deploy Optio API and Optio Web as ACA Container Apps
#
# This script:
#   1. Validates prerequisites (az login, RG, CAE, KV, ACR)
#   2. Builds and pushes container images to ACR (unless --skip-build)
#   3. Creates or updates Optio API Container App (internal ingress)
#   4. Creates or updates Optio Web Container App (external ingress)
#   5. Wires KV-referenced secrets via managed identity
#
# Usage:
#   bash scripts/deploy-optio-apps.sh [--dry-run] [--skip-build] [--subscription <id>] [--tag <tag>]
#
#   --dry-run       Validate prerequisites only; do not create/update Container Apps or build images
#   --skip-build    Skip ACR image build (use when images already exist in ACR)
#   --subscription  Azure subscription ID (default: reads from az account show)
#   --tag           Image tag to use (default: latest)
#
# Prerequisites:
#   - az CLI logged in (az login)
#   - Docker available (unless --skip-build)
#   - scripts/optio-api-template.json and scripts/optio-web-template.json present
#
# Exit codes:
#   0 — all steps passed
#   1 — one or more steps failed

set -uo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
RG="rg-avd-dev-eastus"
LOCATION="eastus"
CAE_NAME="cae-dev-eastus"
KV_NAME="kv-ppf-dev-eastus"
ACR_NAME="acrdevd2thdvq46mgnw"
ACR_SERVER="${ACR_NAME}.azurecr.io"
MSI_NAME="id-ppf-aca-dev-eastus"
API_APP_NAME="optio-api"
WEB_APP_NAME="optio-web"
IMAGE_TAG="latest"
DRY_RUN=false
SKIP_BUILD=false
SUBSCRIPTION_ID=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)      DRY_RUN=true;            shift ;;
    --skip-build)   SKIP_BUILD=true;         shift ;;
    --subscription) SUBSCRIPTION_ID="$2";   shift 2 ;;
    --tag)          IMAGE_TAG="$2";          shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/deploy-optio-apps.sh [--dry-run] [--skip-build] [--subscription <id>] [--tag <tag>]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0

log()        { echo "[deploy] $*"; }
err()        { echo "[deploy] ERROR: $*" >&2; }
step_pass()  { echo "  [PASS] $*"; (( PASS_COUNT++ )) || true; }
step_fail()  { echo "  [FAIL] $*"; (( FAIL_COUNT++ )) || true; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "=== Optio ACA Deployment ==="
[[ "$DRY_RUN"    == "true" ]] && echo "Mode: DRY-RUN (prerequisite validation only)"
[[ "$DRY_RUN"    == "false" ]] && echo "Mode: LIVE"
[[ "$SKIP_BUILD" == "true" ]] && echo "Build: SKIPPED"
echo ""

# ---------------------------------------------------------------------------
# Step 1: az login check
# ---------------------------------------------------------------------------
log "=== Step 1: az CLI login check ==="
if az account show --query "id" -o tsv &>/dev/null; then
  CURRENT_SUB=$(az account show --query "id" -o tsv 2>/dev/null)
  step_pass "az CLI logged in (subscription: ${CURRENT_SUB})"
  # Use CLI subscription if none explicitly provided
  if [[ -z "${SUBSCRIPTION_ID}" ]]; then
    SUBSCRIPTION_ID="${CURRENT_SUB}"
    log "  Using active subscription: ${SUBSCRIPTION_ID}"
  fi
else
  step_fail "az CLI not logged in — run: az login"
  echo ""
  echo "RESULT: FAIL — prerequisite checks failed."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Resource Group exists
# ---------------------------------------------------------------------------
log "=== Step 2: Resource Group check ==="
RG_STATE=$(az group show --name "${RG}" --query "properties.provisioningState" -o tsv 2>/dev/null || echo "NotFound")
if [[ "${RG_STATE}" == "Succeeded" ]]; then
  step_pass "Resource Group '${RG}' exists (state: Succeeded)"
else
  step_fail "Resource Group '${RG}' not found or not in Succeeded state (state: ${RG_STATE})"
fi

# ---------------------------------------------------------------------------
# Step 3: Container Apps Environment exists
# ---------------------------------------------------------------------------
log "=== Step 3: Container Apps Environment check ==="
CAE_STATE=$(az containerapp env show \
  --name "${CAE_NAME}" \
  --resource-group "${RG}" \
  --query "properties.provisioningState" -o tsv 2>/dev/null || echo "NotFound")
if [[ "${CAE_STATE}" == "Succeeded" ]]; then
  step_pass "Container Apps Environment '${CAE_NAME}' exists (state: Succeeded)"
else
  step_fail "Container Apps Environment '${CAE_NAME}' not found or not ready (state: ${CAE_STATE})"
fi

# ---------------------------------------------------------------------------
# Step 4: Key Vault accessible
# ---------------------------------------------------------------------------
log "=== Step 4: Key Vault access check ==="
KV_URI=$(az keyvault show \
  --name "${KV_NAME}" \
  --query "properties.vaultUri" -o tsv 2>/dev/null || echo "")
if [[ -n "${KV_URI}" ]]; then
  step_pass "Key Vault '${KV_NAME}' accessible (URI: ${KV_URI})"
else
  step_fail "Key Vault '${KV_NAME}' not accessible — verify az login identity has Reader role"
fi

# ---------------------------------------------------------------------------
# Step 5: ACR accessible
# ---------------------------------------------------------------------------
log "=== Step 5: ACR access check ==="
ACR_LOGIN_SERVER=$(az acr show \
  --name "${ACR_NAME}" \
  --resource-group "${RG}" \
  --query "loginServer" -o tsv 2>/dev/null || echo "")
if [[ "${ACR_LOGIN_SERVER}" == "${ACR_SERVER}" ]]; then
  step_pass "ACR '${ACR_NAME}' accessible (loginServer: ${ACR_LOGIN_SERVER})"
else
  step_fail "ACR '${ACR_NAME}' not accessible or loginServer mismatch (got: '${ACR_LOGIN_SERVER}', expected: '${ACR_SERVER}')"
fi

# ---------------------------------------------------------------------------
# Step 6: Template files present and valid JSON
# ---------------------------------------------------------------------------
log "=== Step 6: Template file validation ==="
API_TEMPLATE="scripts/optio-api-template.json"
WEB_TEMPLATE="scripts/optio-web-template.json"

if [[ -f "${API_TEMPLATE}" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('${API_TEMPLATE}','utf8'))" 2>/dev/null; then
    step_pass "${API_TEMPLATE} exists and is valid JSON"
  else
    step_fail "${API_TEMPLATE} exists but is not valid JSON"
  fi
else
  step_fail "${API_TEMPLATE} not found"
fi

if [[ -f "${WEB_TEMPLATE}" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('${WEB_TEMPLATE}','utf8'))" 2>/dev/null; then
    step_pass "${WEB_TEMPLATE} exists and is valid JSON"
  else
    step_fail "${WEB_TEMPLATE} exists but is not valid JSON"
  fi
else
  step_fail "${WEB_TEMPLATE} not found"
fi

# ---------------------------------------------------------------------------
# Abort here if dry-run or if prerequisite checks failed
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "============================================"
  echo " Optio Deployment Dry-Run Summary"
  echo "============================================"
  echo "  Passed:  $PASS_COUNT"
  echo "  Failed:  $FAIL_COUNT"
  echo "============================================"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo ""
    echo "RESULT: FAIL — $FAIL_COUNT prerequisite check(s) failed."
    exit 1
  else
    echo ""
    echo "RESULT: PASS — All prerequisite checks passed. Re-run without --dry-run to deploy."
    exit 0
  fi
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL_COUNT prerequisite check(s) failed. Fix issues before deploying."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 7: Build and push images (unless --skip-build)
# ---------------------------------------------------------------------------
log "=== Step 7: ACR image build ==="
if [[ "$SKIP_BUILD" == "true" ]]; then
  log "  --skip-build set — skipping ACR task builds."
  step_pass "Image build skipped (--skip-build)"
else
  log "  Submitting ACR task build for optio-api (tag: ${IMAGE_TAG}) ..."
  if az acr build \
    --registry "${ACR_NAME}" \
    --image "optio-api:${IMAGE_TAG}" \
    --file "apps/api/Dockerfile" \
    . ; then
    step_pass "ACR build succeeded for optio-api:${IMAGE_TAG}"
  else
    step_fail "ACR build failed for optio-api:${IMAGE_TAG}"
  fi

  log "  Submitting ACR task build for optio-web (tag: ${IMAGE_TAG}) ..."
  if az acr build \
    --registry "${ACR_NAME}" \
    --image "optio-web:${IMAGE_TAG}" \
    --file "apps/web/Dockerfile" \
    . ; then
    step_pass "ACR build succeeded for optio-web:${IMAGE_TAG}"
  else
    step_fail "ACR build failed for optio-web:${IMAGE_TAG}"
  fi

  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo ""
    echo "RESULT: FAIL — image build(s) failed. Aborting deployment."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 8: Deploy Optio API (internal ingress)
# ---------------------------------------------------------------------------
log "=== Step 8: Deploy Optio API Container App ==="

# Substitute __SUBSCRIPTION_ID__ placeholder in template, write to temp file
API_RENDERED=$(mktemp /tmp/optio-api-rendered.XXXXXX.json)
sed "s|__SUBSCRIPTION_ID__|${SUBSCRIPTION_ID}|g" "${API_TEMPLATE}" > "${API_RENDERED}"

# Check whether app already exists
API_EXISTS=$(az containerapp show \
  --name "${API_APP_NAME}" \
  --resource-group "${RG}" \
  --query "name" -o tsv 2>/dev/null || echo "")

if [[ -z "${API_EXISTS}" ]]; then
  log "  Creating Optio API Container App '${API_APP_NAME}' ..."
  if az containerapp create \
    --name "${API_APP_NAME}" \
    --resource-group "${RG}" \
    --yaml "${API_RENDERED}" ; then
    step_pass "Optio API Container App '${API_APP_NAME}' created successfully"
  else
    step_fail "Optio API Container App '${API_APP_NAME}' create failed"
  fi
else
  log "  Updating existing Optio API Container App '${API_APP_NAME}' ..."
  if az containerapp update \
    --name "${API_APP_NAME}" \
    --resource-group "${RG}" \
    --image "${ACR_SERVER}/optio-api:${IMAGE_TAG}" ; then
    step_pass "Optio API Container App '${API_APP_NAME}' updated successfully"
  else
    step_fail "Optio API Container App '${API_APP_NAME}' update failed"
  fi
fi
rm -f "${API_RENDERED}"

# ---------------------------------------------------------------------------
# Step 9: Resolve Optio API internal FQDN
# ---------------------------------------------------------------------------
log "=== Step 9: Resolve Optio API internal FQDN ==="
API_FQDN=$(az containerapp show \
  --name "${API_APP_NAME}" \
  --resource-group "${RG}" \
  --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [[ -n "${API_FQDN}" ]]; then
  step_pass "Optio API internal FQDN: ${API_FQDN}"
  log "  Will configure Optio Web API_URL=https://${API_FQDN}"
else
  step_fail "Could not resolve Optio API internal FQDN — Web deployment may have wrong API_URL"
  API_FQDN="optio-api.internal"  # fallback so we don't abort
fi

# ---------------------------------------------------------------------------
# Step 10: Deploy Optio Web (external ingress)
# ---------------------------------------------------------------------------
log "=== Step 10: Deploy Optio Web Container App ==="

# Substitute __SUBSCRIPTION_ID__ and __OPTIO_API_FQDN__ placeholders
WEB_RENDERED=$(mktemp /tmp/optio-web-rendered.XXXXXX.json)
sed \
  -e "s|__SUBSCRIPTION_ID__|${SUBSCRIPTION_ID}|g" \
  -e "s|__OPTIO_API_FQDN__|https://${API_FQDN}|g" \
  "${WEB_TEMPLATE}" > "${WEB_RENDERED}"

# Check whether app already exists
WEB_EXISTS=$(az containerapp show \
  --name "${WEB_APP_NAME}" \
  --resource-group "${RG}" \
  --query "name" -o tsv 2>/dev/null || echo "")

if [[ -z "${WEB_EXISTS}" ]]; then
  log "  Creating Optio Web Container App '${WEB_APP_NAME}' ..."
  if az containerapp create \
    --name "${WEB_APP_NAME}" \
    --resource-group "${RG}" \
    --yaml "${WEB_RENDERED}" ; then
    step_pass "Optio Web Container App '${WEB_APP_NAME}' created successfully"
  else
    step_fail "Optio Web Container App '${WEB_APP_NAME}' create failed"
  fi
else
  log "  Updating existing Optio Web Container App '${WEB_APP_NAME}' ..."
  if az containerapp update \
    --name "${WEB_APP_NAME}" \
    --resource-group "${RG}" \
    --image "${ACR_SERVER}/optio-web:${IMAGE_TAG}" ; then
    step_pass "Optio Web Container App '${WEB_APP_NAME}' updated successfully"
  else
    step_fail "Optio Web Container App '${WEB_APP_NAME}' update failed"
  fi
fi
rm -f "${WEB_RENDERED}"

# ---------------------------------------------------------------------------
# Step 11: Report Optio Web external URL
# ---------------------------------------------------------------------------
log "=== Step 11: Optio Web external URL ==="
WEB_FQDN=$(az containerapp show \
  --name "${WEB_APP_NAME}" \
  --resource-group "${RG}" \
  --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")
if [[ -n "${WEB_FQDN}" ]]; then
  step_pass "Optio Web external URL: https://${WEB_FQDN}"
else
  step_fail "Could not resolve Optio Web external FQDN"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo " Optio Deployment Summary"
echo "============================================"
echo "  Passed:  $PASS_COUNT"
echo "  Failed:  $FAIL_COUNT"
echo "============================================"
[[ -n "${API_FQDN}" ]] && echo "  Optio API (internal): https://${API_FQDN}"
[[ -n "${WEB_FQDN}" ]] && echo "  Optio Web (external): https://${WEB_FQDN}"
echo "============================================"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL_COUNT step(s) failed."
  exit 1
else
  echo ""
  echo "RESULT: PASS — All deployment steps succeeded."
  exit 0
fi
