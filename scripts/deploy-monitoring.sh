#!/usr/bin/env bash
# deploy-monitoring.sh — Deploy Azure Monitor alert rule and App Insights workbook
#                        for Optio ACA agent job monitoring.
#
# Usage:
#   ./scripts/deploy-monitoring.sh --email alerts@example.com [--dry-run]
#
# Required:
#   --email <address>   Alert notification recipient
#
# Optional:
#   --dry-run           Validate and print substituted values; no Azure calls
#   --resource-group    Override default resource group (default: rg-avd-dev-eastus)
#   --job-name          Override ACA job name (default: optio-agent-job)
#
# Prerequisites (non-dry-run):
#   az login (or SP env vars AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID)
#   jq
#
# Exit codes:
#   0 — success (or dry-run validation passed)
#   1 — argument error or one or more deployment steps failed

set -uo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
ALERT_EMAIL=""
DRY_RUN=false
RESOURCE_GROUP="rg-avd-dev-eastus"
JOB_NAME="optio-agent-job"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALERT_TEMPLATE="$SCRIPT_DIR/monitoring/alert-rule.json"
WORKBOOK_TEMPLATE="$SCRIPT_DIR/monitoring/workbook.json"
# Relative paths used for node calls (node is a native Windows process on this host;
# POSIX absolute paths from bash pwd are misinterpreted by node — use relative paths
# anchored to ROOT instead).
ALERT_TEMPLATE_REL="scripts/monitoring/alert-rule.json"
WORKBOOK_TEMPLATE_REL="scripts/monitoring/workbook.json"

cd "$ROOT"

PASS=0
FAIL=0

pass_step() { echo "  [PASS] $*"; (( PASS++ )) || true; }
fail_step() { echo "  [FAIL] $*"; (( FAIL++ )) || true; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      ALERT_EMAIL="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    --resource-group)
      RESOURCE_GROUP="$2"; shift 2 ;;
    --job-name)
      JOB_NAME="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --email <address> [--dry-run] [--resource-group <rg>] [--job-name <name>]" >&2
      exit 1 ;;
  esac
done

if [[ -z "$ALERT_EMAIL" ]]; then
  echo "ERROR: --email is required." >&2
  echo "Usage: $0 --email <address> [--dry-run]" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve subscription ID
# ---------------------------------------------------------------------------
echo "=== Optio Monitoring Deployment ==="
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Skipping 'az account show' — using placeholder SUBSCRIPTION_ID for preview."
  SUBSCRIPTION_ID="<dry-run-subscription-id>"
else
  echo "--- Resolving subscription ID ---"
  if ! command -v az &>/dev/null; then
    echo "ERROR: 'az' CLI not found. Install Azure CLI or run with --dry-run." >&2
    exit 1
  fi
  SUBSCRIPTION_ID=$(az account show --query id -o tsv 2>/dev/null) || {
    echo "ERROR: Could not retrieve subscription ID. Are you logged in? (az login)" >&2
    exit 1
  }
  echo "  Subscription: $SUBSCRIPTION_ID"
  echo "  Resource Group: $RESOURCE_GROUP"
  echo "  Job Name: $JOB_NAME"
  echo "  Alert Email: $ALERT_EMAIL"
fi

# ---------------------------------------------------------------------------
# Template validation
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 1: Validate alert-rule.json ---"
if [[ ! -f "$ALERT_TEMPLATE" ]]; then
  fail_step "Alert template not found: $ALERT_TEMPLATE"
else
  if node -e "JSON.parse(require('fs').readFileSync('$ALERT_TEMPLATE_REL','utf8'))" 2>/dev/null; then
    pass_step "alert-rule.json is valid JSON"
  else
    fail_step "alert-rule.json failed JSON validation"
  fi
fi

# ---------------------------------------------------------------------------
# Substitute placeholders into a temp file
# ---------------------------------------------------------------------------
TMPDIR_DEPLOY="$(mktemp -d)"
ALERT_RENDERED="$TMPDIR_DEPLOY/alert-rule-rendered.json"

echo ""
echo "--- Step 2: Substitute template placeholders ---"
if [[ "$FAIL" -gt 0 ]]; then
  fail_step "Skipping substitution — alert template invalid"
else
  sed \
    -e "s|__SUBSCRIPTION_ID__|${SUBSCRIPTION_ID}|g" \
    -e "s|__RESOURCE_GROUP__|${RESOURCE_GROUP}|g" \
    -e "s|__ALERT_EMAIL__|${ALERT_EMAIL}|g" \
    "$ALERT_TEMPLATE" > "$ALERT_RENDERED"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] Rendered alert-rule.json (substituted values):"
    echo "    SUBSCRIPTION_ID = $SUBSCRIPTION_ID"
    echo "    RESOURCE_GROUP  = $RESOURCE_GROUP"
    echo "    ALERT_EMAIL     = $ALERT_EMAIL"
    echo "    Output file     = $ALERT_RENDERED"
    pass_step "Placeholder substitution preview complete"
  else
    pass_step "Placeholders substituted into rendered template"
  fi
fi

# ---------------------------------------------------------------------------
# Workbook template validation (if exists — T02 will create it)
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 3: Validate workbook.json (if present) ---"
if [[ -f "$WORKBOOK_TEMPLATE" ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('$WORKBOOK_TEMPLATE_REL','utf8'))" 2>/dev/null; then
    pass_step "workbook.json is valid JSON"
  else
    fail_step "workbook.json failed JSON validation"
  fi
else
  echo "  [SKIP] workbook.json not yet present (will be deployed in T02)"
fi

# ---------------------------------------------------------------------------
# Dry-run: exit here
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "=== Dry-run complete. No Azure resources were created. ==="
  echo ""
  echo "  Steps passed : $PASS"
  echo "  Steps failed : $FAIL"
  echo ""
  if [[ "$FAIL" -gt 0 ]]; then
    echo "RESULT: FAIL — fix the issues above before live deployment."
    rm -rf "$TMPDIR_DEPLOY"
    exit 1
  fi
  echo "RESULT: PASS — template is ready for live deployment."
  rm -rf "$TMPDIR_DEPLOY"
  exit 0
fi

# ---------------------------------------------------------------------------
# Deploy action group
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 4: Deploy action group ---"
ACTION_GROUP_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.insights/actionGroups/ag-optio-alerts"

if az monitor action-group create \
     --resource-group "$RESOURCE_GROUP" \
     --name "ag-optio-alerts" \
     --short-name "optio-alrt" \
     --email "alert-recipient" "$ALERT_EMAIL" \
     --output none 2>/dev/null; then
  pass_step "Action group 'ag-optio-alerts' created/updated"
else
  fail_step "Failed to create action group 'ag-optio-alerts'"
fi

# ---------------------------------------------------------------------------
# Deploy metric alert rule
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 5: Deploy metric alert rule ---"
JOB_RESOURCE_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.App/jobs/${JOB_NAME}"

if az monitor metrics alert create \
     --resource-group "$RESOURCE_GROUP" \
     --name "alert-optio-job-failure" \
     --description "Fires when ${JOB_NAME} execution(s) fail in ${RESOURCE_GROUP}" \
     --severity 2 \
     --scopes "$JOB_RESOURCE_ID" \
     --condition "count JobExecutionFailedCount >= 1" \
     --evaluation-frequency "1m" \
     --window-size "5m" \
     --action "$ACTION_GROUP_ID" \
     --output none 2>/dev/null; then
  pass_step "Metric alert rule 'alert-optio-job-failure' created/updated"
else
  fail_step "Failed to create metric alert rule 'alert-optio-job-failure'"
fi

# ---------------------------------------------------------------------------
# Deploy workbook (if template exists)
# ---------------------------------------------------------------------------
echo ""
echo "--- Step 6: Deploy workbook (if template present) ---"
if [[ -f "$WORKBOOK_TEMPLATE" ]]; then
  APP_INSIGHTS_ID="${APP_INSIGHTS_ID:-}"
  if [[ -z "$APP_INSIGHTS_ID" ]]; then
    echo "  [SKIP] APP_INSIGHTS_ID env var not set — skipping workbook deployment."
  else
    WORKBOOK_RENDERED="$TMPDIR_DEPLOY/workbook-rendered.json"
    sed -e "s|__APP_INSIGHTS_ID__|${APP_INSIGHTS_ID}|g" \
        -e "s|__SUBSCRIPTION_ID__|${SUBSCRIPTION_ID}|g" \
        -e "s|__RESOURCE_GROUP__|${RESOURCE_GROUP}|g" \
        "$WORKBOOK_TEMPLATE" > "$WORKBOOK_RENDERED"

    WORKBOOK_CATEGORY="workbook"
    WORKBOOK_NAME="optio-agent-monitoring"
    if az monitor app-insights workbook create \
         --resource-group "$RESOURCE_GROUP" \
         --name "$WORKBOOK_NAME" \
         --display-name "Optio Agent Monitoring" \
         --category "$WORKBOOK_CATEGORY" \
         --serialized-data "@$WORKBOOK_RENDERED" \
         --output none 2>/dev/null; then
      pass_step "Workbook 'optio-agent-monitoring' created/updated"
    else
      # Fallback: az rest for environments where workbook SDK command is unavailable
      LOCATION=$(az group show --name "$RESOURCE_GROUP" --query location -o tsv 2>/dev/null || echo "eastus")
      WORKBOOK_RESOURCE_ID="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.insights/workbooks/${WORKBOOK_NAME}"
      if az rest \
           --method PUT \
           --url "https://management.azure.com${WORKBOOK_RESOURCE_ID}?api-version=2022-04-01" \
           --body "@$WORKBOOK_RENDERED" \
           --output none 2>/dev/null; then
        pass_step "Workbook deployed via az rest fallback"
      else
        fail_step "Workbook deployment failed (both az monitor and az rest)"
      fi
    fi
  fi
else
  echo "  [SKIP] workbook.json not present — skipping workbook deployment"
fi

# ---------------------------------------------------------------------------
# Cleanup and summary
# ---------------------------------------------------------------------------
rm -rf "$TMPDIR_DEPLOY"

echo ""
echo "============================================"
echo " Optio Monitoring Deployment Summary"
echo "============================================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "============================================"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "RESULT: FAIL — $FAIL deployment step(s) failed."
  exit 1
fi

echo ""
echo "RESULT: PASS — All $PASS deployment steps succeeded."
exit 0
