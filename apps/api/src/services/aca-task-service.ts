/**
 * aca-task-service.ts — Execute Optio tasks as Azure Container Apps Jobs.
 *
 * Replaces the K8s pod-per-repo execution path when OPTIO_RUNTIME=aca.
 * Each task creates an ephemeral ACA Job that clones the repo, runs the
 * agent CLI, and exits. Logs are retrieved after completion.
 */

import { AcaContainerRuntime } from "@optio/container-runtime-aca";
import type {
  AcaJobConfig,
  AcaJobTemplate,
  ExecutionRunningState,
} from "@optio/container-runtime-aca";
import { logger } from "../logger.js";
import * as taskService from "./task-service.js";
import { parseClaudeEvent } from "./agent-event-parser.js";
import { parseCodexEvent } from "./codex-event-parser.js";
import { parseCopilotEvent } from "./copilot-event-parser.js";
import { publishEvent } from "./event-bus.js";

// ── Config ────────────────────────────────────────────────────────────────

function getAcaConfig(): AcaJobConfig {
  const required = (name: string): string => {
    const val = process.env[name];
    if (!val) throw new Error(`Missing required env var: ${name}`);
    return val;
  };

  return {
    subscriptionId: required("ACA_SUBSCRIPTION_ID"),
    resourceGroup: required("ACA_RESOURCE_GROUP"),
    environmentName: required("ACA_ENVIRONMENT_NAME"),
    environmentId: required("ACA_ENVIRONMENT_ID"),
    registryServer: required("ACA_REGISTRY_SERVER"),
    imageName: process.env.ACA_DEFAULT_IMAGE ?? "optio-agent-base:latest",
    managedIdentityId: required("ACA_MANAGED_IDENTITY_ID"),
    location: process.env.ACA_LOCATION ?? "eastus",
  };
}

let _runtime: AcaContainerRuntime | null = null;

function getAcaRuntime(): AcaContainerRuntime {
  if (!_runtime) {
    _runtime = new AcaContainerRuntime(getAcaConfig());
  }
  return _runtime;
}

// ── Job name sanitization ─────────────────────────────────────────────────

/** ACA job names: [a-z][a-z0-9-]{0,29} */
function sanitizeJobName(taskId: string): string {
  // Use first 8 chars of the UUID + timestamp suffix for uniqueness
  const prefix = "optio-task";
  const idPart = taskId.replace(/[^a-z0-9]/g, "").slice(0, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}-${idPart}-${ts}`.slice(0, 30);
}

// ── Main execution function ───────────────────────────────────────────────

export interface AcaTaskResult {
  success: boolean;
  logs: string;
  status: string;
  /** PR URL detected during live log polling (most reliable source). */
  prUrl?: string;
}

// ── Log Analytics live polling ────────────────────────────────────────────

const TERMINAL_STATES = new Set<string>(["Succeeded", "Failed", "Stopped", "Degraded"]);
const LOG_POLL_INTERVAL_MS = 15_000;
const STATUS_POLL_INTERVAL_MS = 5_000;

// queryNewLogs delegates to the ACA runtime's queryLogAnalytics method
// (which has access to @azure/identity via its own package dependencies)

/**
 * Process a log line: parse it as an agent event and store it + publish to WebSocket.
 */
async function processLogLine(
  line: string,
  taskId: string,
  agentType: string,
): Promise<{ sessionId?: string; prUrl?: string }> {
  if (!line.trim()) return {};

  const parsed =
    agentType === "codex"
      ? parseCodexEvent(line, taskId)
      : agentType === "copilot"
        ? parseCopilotEvent(line, taskId)
        : parseClaudeEvent(line, taskId);

  let sessionId: string | undefined;
  let prUrl: string | undefined;

  if (parsed.sessionId) sessionId = parsed.sessionId;

  for (const entry of parsed.entries) {
    await taskService.appendTaskLog(taskId, entry.content, "stdout", entry.type, entry.metadata);

    // Detect PR URLs
    const prUrlPattern =
      /https:\/\/(?![\w.-]+\/api\/)[^\s"]+\/(?:pull\/\d+|-\/merge_requests\/\d+)/g;
    const prMatches = entry.content.match(prUrlPattern);
    if (prMatches) prUrl = prMatches[prMatches.length - 1];
  }

  return { sessionId, prUrl };
}

/**
 * Execute a task as an ACA Job.
 *
 * Flow:
 *   1. Create an ACA Job definition with the agent image + env vars
 *   2. Start an execution with the agent command
 *   3. Poll until done
 *   4. Retrieve logs
 *   5. Clean up the job definition
 */
export async function executeTaskAsAcaJob(
  taskId: string,
  repoUrl: string,
  repoBranch: string,
  agentCommand: string[],
  env: Record<string, string>,
  opts?: {
    imagePreset?: string;
    timeoutMs?: number;
    cpu?: number;
    memory?: string;
  },
): Promise<AcaTaskResult> {
  const runtime = getAcaRuntime();
  const config = getAcaConfig();
  const jobName = sanitizeJobName(taskId);
  const log = logger.child({ taskId, jobName });

  // Resolve image from preset
  const imageTag = resolveAcaImage(opts?.imagePreset, config.imageName);

  log.info({ imageTag, repoUrl }, "Creating ACA Job for task");

  // Build the shell script that runs inside the container.
  // This replaces the K8s repo-init.sh + exec worktree flow with a
  // single-shot clone → setup → run agent → exit.
  const agentScript = buildAcaAgentScript(taskId, repoUrl, repoBranch, agentCommand, env);

  // Create the job definition
  const template: AcaJobTemplate = {
    replicaTimeoutInSeconds: Math.ceil((opts?.timeoutMs ?? 1_800_000) / 1000),
    replicaRetryLimit: 0,
    cpu: opts?.cpu ?? 1,
    memory: opts?.memory ?? "2Gi",
    imageName: imageTag,
    command: ["/bin/bash", "-c", agentScript],
    env: buildAcaEnvVars(env),
  };

  try {
    await runtime.createJob(jobName, template);
    log.info("ACA Job created, starting execution");

    const execution = await runtime.startExecution(jobName);
    log.info({ executionName: execution.name }, "ACA execution started");

    // Custom polling loop: check execution status AND stream logs from Log Analytics
    const timeoutMs = opts?.timeoutMs ?? 1_800_000;
    const deadline = Date.now() + timeoutMs;
    let lastStatus: ExecutionRunningState = "Running";
    let logIndex = 0;
    let lastLogPoll = 0;
    let allLogs = "";
    let capturedSessionId: string | undefined;
    let capturedPrUrl: string | undefined;
    const agentType = env.OPTIO_AGENT_TYPE ?? "claude-code";

    while (true) {
      // Check execution status
      const snap = await runtime.getExecutionStatus(jobName, execution.name);
      lastStatus = snap.status;

      // Poll Log Analytics for new log lines (every LOG_POLL_INTERVAL_MS)
      const now = Date.now();
      if (now - lastLogPoll >= LOG_POLL_INTERVAL_MS) {
        lastLogPoll = now;
        const { lines, totalCount } = await runtime.queryLogAnalytics(jobName, logIndex);
        if (lines.length > 0) {
          log.info({ newLines: lines.length, total: totalCount }, "Streaming new log lines");
          logIndex = totalCount;

          for (const line of lines) {
            allLogs += line + "\n";
            const result = await processLogLine(line, taskId, agentType);
            if (result.sessionId && !capturedSessionId) {
              capturedSessionId = result.sessionId;
              await taskService.updateTaskSession(taskId, capturedSessionId);
              log.info({ sessionId: capturedSessionId }, "Session ID captured");
            }
            if (result.prUrl) {
              capturedPrUrl = result.prUrl;
              log.info({ prUrl: capturedPrUrl }, "PR URL captured during live polling");
            }
          }

          // Bump heartbeat so stall detector knows we're alive
          await taskService.touchTaskHeartbeat(taskId);
          await taskService.updateTaskActivity(taskId, new Date());
        }
      }

      // Check if terminal
      if (TERMINAL_STATES.has(snap.status)) {
        log.info({ status: snap.status }, "ACA execution reached terminal state");

        // Final log fetch — wait for Log Analytics ingestion then poll multiple
        // times to catch late-arriving lines (PR URLs, cost data, final result)
        log.info("Waiting for final log ingestion...");
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((r) => setTimeout(r, 30_000));
          const { lines: finalLines, totalCount: finalCount } = await runtime.queryLogAnalytics(
            jobName,
            logIndex,
          );
          if (finalLines.length > 0) {
            log.info({ newLines: finalLines.length, attempt }, "Final log batch");
            for (const line of finalLines) {
              allLogs += line + "\n";
              const result = await processLogLine(line, taskId, agentType);
              if (result.sessionId && !capturedSessionId) {
                capturedSessionId = result.sessionId;
                await taskService.updateTaskSession(taskId, capturedSessionId);
              }
              if (result.prUrl) {
                capturedPrUrl = result.prUrl;
              }
            }
            logIndex = finalCount;
          } else if (attempt >= 1) {
            // No new lines for 2 consecutive polls — ingestion is caught up
            break;
          }
        }
        log.info({ totalLogLines: logIndex }, "Final log fetch complete");
        break;
      }

      // Timeout check
      if (Date.now() >= deadline) {
        log.warn("ACA execution timed out");
        lastStatus = "Failed";
        break;
      }

      await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
    }

    return {
      success: lastStatus === "Succeeded",
      logs: allLogs,
      status: lastStatus,
      prUrl: capturedPrUrl,
    };
  } finally {
    // Always clean up the job definition
    try {
      await runtime.cleanup(jobName);
      log.info("ACA Job cleaned up");
    } catch (cleanupErr) {
      log.warn({ err: cleanupErr }, "Failed to clean up ACA Job (non-fatal)");
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function resolveAcaImage(preset: string | undefined, defaultImage: string): string {
  // Use the default agent image for all presets — ACA uses a single
  // general-purpose image (gsd-agent) rather than per-language presets.
  // The default image is configured via ACA_DEFAULT_IMAGE env var.
  return defaultImage;
}

/**
 * Build the single-shot bash script that runs inside the ACA Job container.
 *
 * This script:
 *   1. Clones the repo
 *   2. Creates a task branch
 *   3. Configures git identity
 *   4. Writes setup files (task.md, CLAUDE.md, etc.)
 *   5. Runs the agent CLI
 */
function buildAcaAgentScript(
  taskId: string,
  repoUrl: string,
  repoBranch: string,
  agentCommand: string[],
  env: Record<string, string>,
): string {
  const lines: string[] = [
    "set -e",
    'echo "[optio-aca] Starting ACA task execution"',

    // Configure git credentials if token is available
    'if [ -n "${GITHUB_TOKEN:-}" ]; then',
    '  echo "[optio-aca] Configuring git credentials"',
    "  git config --global credential.helper '!f() { echo username=x-access-token; echo password=${GITHUB_TOKEN}; }; f'",
    "fi",
    'if [ -n "${GITLAB_TOKEN:-}" ]; then',
    '  GITLAB_HOST="${GITLAB_HOST:-gitlab.com}"',
    "  git config --global credential.helper '!f() { echo username=oauth2; echo password=${GITLAB_TOKEN}; }; f'",
    "fi",

    // Clone the repo
    'echo "[optio-aca] Cloning repo..."',
    `git clone --branch "${repoBranch}" "${repoUrl}" /workspace/repo 2>&1 || {`,
    // Retry with token-embedded URL for private repos
    `  if [ -n "\${GITHUB_TOKEN:-}" ]; then`,
    `    CLONE_URL=$(echo "${repoUrl}" | sed "s|https://|https://x-access-token:\${GITHUB_TOKEN}@|")`,
    `    git clone --branch "${repoBranch}" "$CLONE_URL" /workspace/repo 2>&1`,
    `  else`,
    `    echo "[optio-aca] ERROR: git clone failed and no token available" >&2`,
    `    exit 1`,
    `  fi`,
    `}`,

    // Create or checkout task branch
    "cd /workspace/repo",
    `if [ "\${OPTIO_RESTART_FROM_BRANCH:-}" = "true" ]; then`,
    `  echo "[optio-aca] Restarting from existing branch optio/task-${taskId}"`,
    `  git fetch origin "optio/task-${taskId}" 2>/dev/null && git checkout "optio/task-${taskId}" || {`,
    `    echo "[optio-aca] Branch not found on remote — creating fresh branch"`,
    `    git checkout -b "optio/task-${taskId}"`,
    `  }`,
    `else`,
    `  git push origin --delete "optio/task-${taskId}" 2>/dev/null || true`,
    `  git checkout -b "optio/task-${taskId}"`,
    `fi`,
    `git config user.name "\${GITHUB_APP_BOT_NAME:-Optio Agent}"`,
    `git config user.email "\${GITHUB_APP_BOT_EMAIL:-optio-agent@noreply.github.com}"`,
    'echo "[optio-aca] Repo ready"',

    // Set up gh CLI auth
    'if [ -n "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then',
    '  echo "${GITHUB_TOKEN}" | gh auth login --with-token 2>/dev/null || true',
    "fi",

    // Write setup files if provided (base64-encoded JSON array)
    'if [ -n "${OPTIO_SETUP_FILES:-}" ]; then',
    '  echo "[optio-aca] Writing setup files..."',
    '  echo "${OPTIO_SETUP_FILES}" | base64 -d | python3 -c "',
    "import json, sys, os",
    "files = json.load(sys.stdin)",
    "for f in files:",
    "    path = f['path']",
    "    full = os.path.join('/workspace/repo', path)",
    "    os.makedirs(os.path.dirname(full), exist_ok=True)",
    "    with open(full, 'w') as fh:",
    "        fh.write(f['content'])",
    "    print(f'  wrote {path}')",
    '"',
    "fi",

    // Run .optio/setup.sh if it exists
    "if [ -f /workspace/repo/.optio/setup.sh ]; then",
    '  echo "[optio-aca] Running .optio/setup.sh"',
    "  bash /workspace/repo/.optio/setup.sh",
    "fi",

    // Install extra packages if configured
    'if [ -n "${OPTIO_EXTRA_PACKAGES:-}" ]; then',
    '  echo "[optio-aca] Installing extra packages: ${OPTIO_EXTRA_PACKAGES}"',
    "  apt-get update -qq && apt-get install -y -qq ${OPTIO_EXTRA_PACKAGES} || true",
    "fi",

    // Run setup commands if configured
    'if [ -n "${OPTIO_SETUP_COMMANDS:-}" ]; then',
    '  echo "[optio-aca] Running setup commands"',
    '  eval "${OPTIO_SETUP_COMMANDS}" || true',
    "fi",

    // Install MCP servers if configured
    'if [ -n "${OPTIO_MCP_INSTALL_COMMANDS:-}" ]; then',
    '  echo "[optio-aca] Installing MCP servers"',
    '  eval "${OPTIO_MCP_INSTALL_COMMANDS}" || true',
    "fi",

    // Build code-review-graph if available (helps Claude understand the repo faster)
    // Wrapped in timeout + subshell so it can't hang or crash the main script
    "if command -v code-review-graph >/dev/null 2>&1; then",
    '  echo "[optio-aca] Building code-review-graph..."',
    "  (cd /workspace/repo && timeout 120 code-review-graph init . 2>/dev/null; timeout 120 code-review-graph build . 2>&1) || echo '[optio-aca] code-review-graph failed (non-fatal)'",
    "fi",

    // Verify agent CLI is available before running
    `echo "[optio-aca] Agent type: ${env.OPTIO_AGENT_TYPE ?? "unknown"}"`,
    `if [ "${env.OPTIO_AGENT_TYPE ?? ""}" = "azure-foundry" ] && ! command -v aider >/dev/null 2>&1; then`,
    '  echo "[optio-aca] ERROR: aider CLI not found in image. Rebuild agent image with aider-chat." >&2',
    "  exit 1",
    "fi",

    // Run the agent — use set +e so we capture the exit code instead of aborting
    'echo "[optio-aca] Running agent..."',
    `export OPTIO_TASK_ID="${taskId}"`,
    "set +e",
    // Strip --input-format stream-json and --replay-user-messages from the command.
    // These flags make Claude read from stdin (for mid-task messages in the K8s path),
    // but ACA Jobs have no stdin — Claude gets EOF and exits immediately.
    ...agentCommand.map((line) =>
      line
        .replace(/\s*--input-format\s+stream-json\s*/, " ")
        .replace(/\s*--replay-user-messages\s*/, " ")
        .replace(/\s+\\$/, " \\"),
    ),
    "AGENT_EXIT=$?",
    "set -e",
    'echo "[optio-aca] Agent exited with code ${AGENT_EXIT}"',
    "exit ${AGENT_EXIT}",
  ];

  return lines.join("\n");
}

/**
 * Check if an ACA Job for a task is still running.
 * Used by startup reconcile to avoid killing active ACA Jobs.
 * Returns the execution status if a non-terminal execution exists, null otherwise.
 */
export async function checkAcaJobStatus(
  taskId: string,
): Promise<{ running: boolean; status: string } | null> {
  try {
    const runtime = getAcaRuntime();
    const jobName = sanitizeJobName(taskId);
    const executions = await runtime.listExecutions(jobName);
    if (executions.length === 0) return null;

    // Check the most recent execution
    const latest = executions[executions.length - 1];
    const isRunning = !TERMINAL_STATES.has(latest.status);
    return { running: isRunning, status: latest.status };
  } catch {
    // Job doesn't exist or API error — treat as not running
    return null;
  }
}

/**
 * Convert the task env map to ACA Job env var format.
 * Filters out internal/K8s-specific vars.
 */
function buildAcaEnvVars(env: Record<string, string>): Array<{ name: string; value: string }> {
  // Vars that are K8s-specific or not useful in ACA
  const skip = new Set([
    "OPTIO_GIT_CREDENTIAL_URL",
    "OPTIO_GIT_TASK_CREDENTIAL_URL",
    "OPTIO_CREDENTIAL_SECRET",
  ]);

  return Object.entries(env)
    .filter(([key]) => !skip.has(key))
    .map(([name, value]) => ({ name, value }));
}
