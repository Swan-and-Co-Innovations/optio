/**
 * aca-runtime.ts — AcaContainerRuntime
 *
 * Wraps the Azure Container Apps Jobs lifecycle:
 *   createJob → startExecution → pollUntilDone → getLogs → cleanup
 *
 * API facts (verified against @azure/arm-appcontainers@3.0.0):
 *   - client.jobs.beginCreateOrUpdate(rg, name, envelope) → poller → Job
 *   - client.jobs.beginStart(rg, name, options) → poller → JobExecutionBase
 *     options.template?: JobExecutionTemplate (command overrides go here)
 *   - client.jobExecution(rg, name, executionName) → JobExecution (with status)
 *   - client.jobsExecutions.list(rg, name) → paged JobExecution[]
 *   - client.jobs.beginDelete(rg, name) → poller → void
 *
 * Note: There is no jobsExecutions.get() — status polling uses client.jobExecution().
 */

import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import type { Job, JobExecutionTemplate } from "@azure/arm-appcontainers";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  AcaJobConfig,
  AcaJobTemplate,
  ExecutionConfig,
  ExecutionResult,
  ExecutionRunningState,
  ExecutionStatus,
  TerminalExecutionState,
} from "./types.js";
import { AcaApiError, ExecutionTimeoutError, ValidationError } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const TERMINAL_STATES = new Set<string>(["Succeeded", "Failed", "Stopped", "Degraded"]);

// ── Helpers ────────────────────────────────────────────────────────────────

function assertNonEmpty(value: string | undefined | null, name: string): void {
  if (!value || value.trim().length === 0) {
    throw new ValidationError(`'${name}' must be a non-empty string`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts an HTTP status code from an Azure SDK error if present.
 * The SDK wraps errors in objects with a `statusCode` or `code` property.
 */
function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["statusCode"] === "number") return e["statusCode"] as number;
    if (typeof e["code"] === "number") return e["code"] as number;
  }
  return undefined;
}

function wrapAcaError(operation: string, err: unknown): never {
  const statusCode = extractStatusCode(err);
  const cause = err instanceof Error ? err : new Error(String(err));
  throw new AcaApiError(operation, statusCode, cause);
}

// ── Main class ─────────────────────────────────────────────────────────────

/**
 * Manages the full lifecycle of Azure Container Apps Jobs.
 *
 * @example
 * ```ts
 * const runtime = new AcaContainerRuntime({
 *   subscriptionId: "...",
 *   resourceGroup: "rg-avd-dev-eastus",
 *   environmentName: "cae-dev-eastus",
 *   environmentId: "/subscriptions/.../providers/Microsoft.App/managedEnvironments/cae-dev-eastus",
 *   registryServer: "acrdevd2thdvq46mgnw.azurecr.io",
 *   imageName: "gsd-agent:m001",
 *   managedIdentityId: "/subscriptions/.../userAssignedIdentities/id-ppf-aca-dev-eastus",
 *   location: "eastus",
 * });
 *
 * await runtime.createJob("my-job", { replicaTimeoutInSeconds: 120, replicaRetryLimit: 0, cpu: 0.5, memory: "1Gi" });
 * const exec = await runtime.startExecution("my-job", { command: ["/bin/bash", "-c", "echo hello"] });
 * const result = await runtime.pollUntilDone("my-job", exec.name, 60_000);
 * console.log(result.logs);
 * await runtime.cleanup("my-job");
 * ```
 */
export class AcaContainerRuntime {
  private readonly config: AcaJobConfig;
  private readonly client: ContainerAppsAPIClient;

  constructor(config: AcaJobConfig) {
    // Validate required config fields before any SDK interaction
    assertNonEmpty(config.subscriptionId, "config.subscriptionId");
    assertNonEmpty(config.resourceGroup, "config.resourceGroup");
    assertNonEmpty(config.environmentName, "config.environmentName");
    assertNonEmpty(config.environmentId, "config.environmentId");
    assertNonEmpty(config.registryServer, "config.registryServer");
    assertNonEmpty(config.imageName, "config.imageName");
    assertNonEmpty(config.managedIdentityId, "config.managedIdentityId");
    assertNonEmpty(config.location, "config.location");

    this.config = config;

    /**
     * DefaultAzureCredential resolves credentials in this order:
     *  1. EnvironmentCredential (service principal via env vars)
     *  2. WorkloadIdentityCredential (AKS/ACA managed identity via OIDC)
     *  3. ManagedIdentityCredential (user-assigned MSI — used in production ACA)
     *  4. AzureCliCredential (developer machine with `az login`)
     *
     * No secrets in code — the correct credential is selected automatically
     * based on the execution environment.
     */
    const credential = new DefaultAzureCredential();
    this.client = new ContainerAppsAPIClient(credential, config.subscriptionId);
  }

  // ── Job definition lifecycle ─────────────────────────────────────────────

  /**
   * Creates or updates an ACA Job definition.
   * If the job already exists it is updated in place (idempotent).
   *
   * @param jobName  - ACA job name (must match [a-z][a-z0-9-]{0,29})
   * @param template - Resources and defaults for all executions of this job
   * @returns        The created/updated Job resource
   */
  async createJob(jobName: string, template: AcaJobTemplate): Promise<Job> {
    assertNonEmpty(jobName, "jobName");

    const { resourceGroup, location, environmentId, registryServer, imageName, managedIdentityId } =
      this.config;

    const fullImage = template.imageName
      ? `${registryServer}/${template.imageName}`
      : `${registryServer}/${imageName}`;

    const jobEnvelope: Job = {
      location,
      identity: {
        type: "UserAssigned",
        userAssignedIdentities: {
          [managedIdentityId]: {},
        },
      },
      // Job (ARM SDK v3) has flat properties — no nested 'properties' wrapper
      environmentId,
      configuration: {
        triggerType: "Manual",
        replicaTimeout: template.replicaTimeoutInSeconds,
        replicaRetryLimit: template.replicaRetryLimit,
        registries: [
          {
            server: registryServer,
            identity: managedIdentityId,
          },
        ],
      },
      template: {
        containers: [
          {
            name: jobName,
            image: fullImage,
            ...(template.command ? { command: template.command } : {}),
            env: (template.env ?? []).map((e) => ({ name: e.name, value: e.value })),
            resources: {
              cpu: template.cpu,
              memory: template.memory,
            },
          },
        ],
      },
    };

    try {
      const poller = await this.client.jobs.beginCreateOrUpdate(
        resourceGroup,
        jobName,
        jobEnvelope,
      );
      return await poller.pollUntilDone();
    } catch (err) {
      wrapAcaError(`createJob(${jobName})`, err);
    }
  }

  // ── Execution lifecycle ──────────────────────────────────────────────────

  /**
   * Starts a new execution of an existing ACA Job.
   *
   * @param jobName   - Name of the job to run
   * @param overrides - Optional per-execution command/env overrides
   * @returns         The execution name and ID (use `name` for status polling)
   */
  async startExecution(
    jobName: string,
    overrides?: ExecutionConfig,
  ): Promise<{ name: string; id: string }> {
    assertNonEmpty(jobName, "jobName");

    const { resourceGroup } = this.config;

    let template: JobExecutionTemplate | undefined;
    if (overrides?.command || overrides?.env) {
      template = {
        containers: [
          {
            name: jobName,
            ...(overrides.command ? { command: overrides.command } : {}),
            ...(overrides.env
              ? { env: overrides.env.map((e) => ({ name: e.name, value: e.value })) }
              : {}),
          },
        ],
      };
    }

    try {
      const poller = await this.client.jobs.beginStart(resourceGroup, jobName, {
        ...(template ? { template } : {}),
      });
      const result = await poller.pollUntilDone();

      if (!result.name) {
        throw new Error(
          "ACA beginStart returned a result with no execution name — cannot poll status",
        );
      }

      return { name: result.name, id: result.id ?? result.name };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      wrapAcaError(`startExecution(${jobName})`, err);
    }
  }

  /**
   * Retrieves the current status of a specific execution.
   *
   * Uses `client.jobExecution()` — the per-execution detail endpoint.
   * (Note: `client.jobsExecutions` only exposes `.list()`, not `.get()`.)
   *
   * @param jobName       - Job name
   * @param executionName - Execution name returned by `startExecution`
   * @returns             Current status snapshot
   */
  async getExecutionStatus(jobName: string, executionName: string): Promise<ExecutionStatus> {
    assertNonEmpty(jobName, "jobName");
    assertNonEmpty(executionName, "executionName");

    const { resourceGroup } = this.config;

    try {
      const exec = await this.client.jobExecution(resourceGroup, jobName, executionName);

      if (!exec.name) {
        throw new Error(`jobExecution response missing 'name' field for '${executionName}'`);
      }

      return {
        name: exec.name,
        status: (exec.status as ExecutionRunningState | undefined) ?? "Unknown",
        startTime: exec.startTime,
        endTime: exec.endTime,
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      wrapAcaError(`getExecutionStatus(${jobName}, ${executionName})`, err);
    }
  }

  /**
   * Polls `getExecutionStatus` every 5 seconds until the execution reaches
   * a terminal state (Succeeded / Failed / Stopped / Degraded) or until
   * `timeoutMs` elapses.
   *
   * Special cases:
   *  - `timeoutMs === 0` → throws ExecutionTimeoutError immediately
   *  - Already in terminal state on first poll → returns immediately
   *
   * @param jobName       - Job name
   * @param executionName - Execution name returned by `startExecution`
   * @param timeoutMs     - Milliseconds before giving up (default: 300_000)
   * @returns             Final status and logs
   */
  async pollUntilDone(
    jobName: string,
    executionName: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ExecutionResult> {
    assertNonEmpty(jobName, "jobName");
    assertNonEmpty(executionName, "executionName");

    if (timeoutMs === 0) {
      throw new ExecutionTimeoutError(jobName, executionName, 0, undefined);
    }

    const deadline = Date.now() + timeoutMs;
    let lastStatus: ExecutionRunningState | undefined;

    while (true) {
      const snap = await this.getExecutionStatus(jobName, executionName);
      lastStatus = snap.status;

      if (TERMINAL_STATES.has(snap.status)) {
        const logs = await this.getLogs(jobName, executionName).catch(() => "");
        return {
          status: snap.status as TerminalExecutionState,
          logs,
        };
      }

      if (Date.now() >= deadline) {
        throw new ExecutionTimeoutError(jobName, executionName, timeoutMs, lastStatus);
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Retrieves container log output for a completed execution.
   *
   * Implementation note: The ARM SDK does not expose a Log Analytics query
   * method — that requires the Monitor Query SDK or a direct REST call.
   * This method shells out to `az containerapp logs show` via a child process
   * as the most reliable cross-environment approach for now. The caller can
   * replace this with a Log Analytics query in environments where `az` is
   * not available.
   *
   * @param jobName       - Job name
   * @param executionName - Execution name
   * @returns             Log output as a string, or empty string on failure
   */
  async getLogs(jobName: string, executionName: string): Promise<string> {
    assertNonEmpty(jobName, "jobName");
    assertNonEmpty(executionName, "executionName");

    // Wait for Log Analytics ingestion (typically 1-3 minutes)
    const LOG_INGEST_WAIT_MS = 90_000;
    console.log(`[AcaContainerRuntime] Waiting ${LOG_INGEST_WAIT_MS / 1000}s for log ingestion...`);
    await sleep(LOG_INGEST_WAIT_MS);

    // Query Log Analytics REST API using the same credential chain
    const workspaceId = process.env.ACA_LOG_ANALYTICS_WORKSPACE_ID;
    if (!workspaceId) {
      console.warn(
        "[AcaContainerRuntime] ACA_LOG_ANALYTICS_WORKSPACE_ID not set — cannot retrieve logs",
      );
      return "";
    }

    try {
      const credential = new DefaultAzureCredential();
      const token = await credential.getToken("https://api.loganalytics.io/.default");

      const query = `ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith '${jobName}' | order by TimeGenerated asc | project Log_s`;

      const res = await fetch(`https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, timespan: "PT2H" }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.warn(
          `[AcaContainerRuntime] Log Analytics query failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return "";
      }

      const data = (await res.json()) as { tables: Array<{ rows: string[][] }> };
      const rows = data.tables?.[0]?.rows ?? [];
      const logs = rows.map((r: string[]) => r[0]).join("\n");
      console.log(`[AcaContainerRuntime] Retrieved ${rows.length} log lines from Log Analytics`);
      return logs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[AcaContainerRuntime] getLogs failed (non-fatal): ${message}`);
      return "";
    }
  }

  /**
   * Deletes the ACA Job definition and all its execution history.
   * This is irreversible — use with care outside of test cleanup.
   *
   * @param jobName - Job name to delete
   */
  async cleanup(jobName: string): Promise<void> {
    assertNonEmpty(jobName, "jobName");

    const { resourceGroup } = this.config;

    try {
      const poller = await this.client.jobs.beginDelete(resourceGroup, jobName);
      await poller.pollUntilDone();
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      // 404 means it's already gone — treat as success
      const statusCode = extractStatusCode(err);
      if (statusCode === 404) return;
      wrapAcaError(`cleanup(${jobName})`, err);
    }
  }

  /**
   * Lists all executions for a given job (most recent first).
   * Useful for debugging or finding the latest execution name.
   *
   * @param jobName - Job name
   * @returns       Array of execution status snapshots
   */
  async listExecutions(jobName: string): Promise<ExecutionStatus[]> {
    assertNonEmpty(jobName, "jobName");

    const { resourceGroup } = this.config;

    try {
      const results: ExecutionStatus[] = [];
      for await (const exec of this.client.jobsExecutions.list(resourceGroup, jobName)) {
        results.push({
          name: exec.name ?? "(unknown)",
          status: (exec.status as ExecutionRunningState | undefined) ?? "Unknown",
          startTime: exec.startTime,
          endTime: exec.endTime,
        });
      }
      return results;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      wrapAcaError(`listExecutions(${jobName})`, err);
    }
  }

  /**
   * Query Log Analytics for container logs from an ACA Job.
   * Returns lines after `afterIndex` for incremental polling.
   * Uses the same DefaultAzureCredential as the ARM client.
   */
  async queryLogAnalytics(
    jobName: string,
    afterIndex: number = 0,
  ): Promise<{ lines: string[]; totalCount: number }> {
    const workspaceId = process.env.ACA_LOG_ANALYTICS_WORKSPACE_ID;
    if (!workspaceId) return { lines: [], totalCount: afterIndex };

    try {
      const credential = new DefaultAzureCredential();
      const token = await credential.getToken("https://api.loganalytics.io/.default");

      const query = `ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith '${jobName}' | order by TimeGenerated asc | project Log_s`;

      const res = await fetch(`https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, timespan: "PT2H" }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[AcaContainerRuntime] Log Analytics query failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return { lines: [], totalCount: afterIndex };
      }

      const data = (await res.json()) as { tables: Array<{ rows: string[][] }> };
      const allRows = data.tables?.[0]?.rows ?? [];
      const newLines = allRows.slice(afterIndex).map((r: string[]) => r[0]);
      return { lines: newLines, totalCount: allRows.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[AcaContainerRuntime] queryLogAnalytics failed: ${message}`);
      return { lines: [], totalCount: afterIndex };
    }
  }
}
