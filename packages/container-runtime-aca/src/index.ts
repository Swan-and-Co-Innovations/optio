/**
 * @optio/container-runtime-aca — Public API
 *
 * Drop-in replacement for Optio's K8s container-runtime, targeting
 * Azure Container Apps Jobs.
 *
 * Primary entry point:
 *   import { AcaContainerRuntime } from "@optio/container-runtime-aca";
 */

// Main runtime class
export { AcaContainerRuntime } from "./aca-runtime.js";

// Types needed by callers
export type {
  AcaJobConfig,
  AcaJobTemplate,
  ExecutionConfig,
  ExecutionResult,
  ExecutionRunningState,
  ExecutionStatus,
  TerminalExecutionState,
} from "./types.js";

// Error classes (re-exported for instanceof checks in calling code)
export { AcaApiError, ExecutionTimeoutError, ValidationError } from "./types.js";
