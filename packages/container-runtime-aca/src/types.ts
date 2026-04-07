/**
 * types.ts — Interface definitions for the ACA Jobs container-runtime.
 *
 * All Azure resource names are externalised through AcaJobConfig so no
 * hard-coded references to specific subscriptions, resource groups, or
 * registries appear in the runtime code.
 */

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * Immutable configuration provided once at construction time.
 * Maps to the infrastructure deployed in a specific Azure environment.
 */
export interface AcaJobConfig {
  /** Azure subscription ID (e.g. "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx") */
  subscriptionId: string;
  /** Resource group that owns the Container Apps Environment and jobs */
  resourceGroup: string;
  /** Name of the Container Apps Environment (e.g. "cae-dev-eastus") */
  environmentName: string;
  /** Full resource ID of the Container Apps Environment */
  environmentId: string;
  /** ACR login server (e.g. "acrdevd2thdvq46mgnw.azurecr.io") */
  registryServer: string;
  /** Default container image including tag (e.g. "gsd-agent:m001") */
  imageName: string;
  /**
   * Resource ID of the user-assigned managed identity used for ACR pull
   * and for the DefaultAzureCredential chain when running inside ACA.
   * Format: /subscriptions/.../resourcegroups/.../providers/
   *         Microsoft.ManagedIdentity/userAssignedIdentities/<name>
   */
  managedIdentityId: string;
  /**
   * Azure region for new resources (e.g. "eastus").
   * Required by ARM when creating jobs via the SDK.
   */
  location: string;
}

// ── Per-execution configuration ────────────────────────────────────────────

/**
 * Per-execution overrides passed to `startExecution`.
 * All fields are optional; omitting them uses the job definition's defaults.
 */
export interface ExecutionConfig {
  /**
   * Command to run inside the container, overriding the job template.
   * Example: ["/bin/bash", "-c", "echo hello"]
   */
  command?: string[];
  /**
   * Additional environment variables injected for this execution only.
   * These are merged on top of the job template's env vars.
   */
  env?: Array<{ name: string; value: string }>;
  /**
   * How long to wait (in milliseconds) for the execution to reach a
   * terminal state before `pollUntilDone` throws a timeout error.
   * Default: 300_000 (5 minutes).
   */
  timeoutMs?: number;
}

// ── Status / result types ──────────────────────────────────────────────────

/**
 * Terminal states for a job execution, mirroring the ACA API values.
 * Non-terminal states (Running, Processing) are not included here — callers
 * that need to distinguish them should read `JobExecution.status` directly.
 */
export type TerminalExecutionState = "Succeeded" | "Failed" | "Stopped" | "Degraded";

/** All states the API can return. */
export type ExecutionRunningState =
  | "Running"
  | "Processing"
  | "Succeeded"
  | "Failed"
  | "Stopped"
  | "Degraded"
  | "Unknown";

/** Snapshot of a single execution returned by `getExecutionStatus`. */
export interface ExecutionStatus {
  /** ACA execution name (e.g. "my-job--abc123") */
  name: string;
  /** Current running state as returned by the ACA API */
  status: ExecutionRunningState;
  /** When the execution started (undefined if not yet started) */
  startTime?: Date;
  /** When the execution ended (undefined if still running) */
  endTime?: Date;
}

/** Result returned by `pollUntilDone` after reaching a terminal state. */
export interface ExecutionResult {
  /** Final terminal status */
  status: TerminalExecutionState;
  /** Container log output; empty string if log retrieval failed */
  logs: string;
}

// ── Job template ──────────────────────────────────────────────────────────

/**
 * Minimal typed shape for the job definition template passed to `createJob`.
 * Callers can use the full `@azure/arm-appcontainers` `Job` type for advanced
 * scenarios; this interface captures the subset this runtime needs.
 */
export interface AcaJobTemplate {
  /**
   * Replica timeout in seconds (default: 300).
   * ACA terminates the container if it hasn't exited within this window.
   */
  replicaTimeoutInSeconds: number;
  /** Max number of retries per execution before marking it failed (0 = no retries) */
  replicaRetryLimit: number;
  /** CPU request (e.g. 0.5) */
  cpu: number;
  /** Memory request (e.g. "1Gi") */
  memory: string;
  /**
   * Override the default image from AcaJobConfig for this specific job.
   * If omitted, `AcaJobConfig.imageName` is used.
   */
  imageName?: string;
  /** Default command for the job (overridable at execution time via ExecutionConfig) */
  command?: string[];
  /** Static environment variables for all executions of this job */
  env?: Array<{ name: string; value: string }>;
}

// ── Errors ────────────────────────────────────────────────────────────────

/** Thrown when a required argument fails validation before any API call. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when `pollUntilDone` reaches the timeout without a terminal state. */
export class ExecutionTimeoutError extends Error {
  constructor(
    public readonly jobName: string,
    public readonly executionName: string,
    public readonly timeoutMs: number,
    public readonly lastStatus: ExecutionRunningState | undefined,
  ) {
    super(
      `Execution '${executionName}' of job '${jobName}' did not complete within ${timeoutMs}ms` +
        (lastStatus ? ` (last status: ${lastStatus})` : ""),
    );
    this.name = "ExecutionTimeoutError";
  }
}

/** Wraps ACA API errors with additional context. */
export class AcaApiError extends Error {
  constructor(
    public readonly operation: string,
    public readonly statusCode: number | undefined,
    cause: Error,
  ) {
    super(
      `ACA API error during '${operation}'` +
        (statusCode !== undefined ? ` (HTTP ${statusCode})` : "") +
        `: ${cause.message}`,
    );
    this.name = "AcaApiError";
    this.cause = cause;
  }
}
