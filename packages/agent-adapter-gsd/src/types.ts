/**
 * Configuration for the gsd headless --auto invocation.
 */
export interface GsdHeadlessConfig {
  /** Absolute path to the workspace/repo that gsd operates on. */
  workspacePath: string;

  /**
   * Maximum time in milliseconds to wait for gsd headless to complete.
   * @default 600000  (10 minutes)
   */
  timeoutMs?: number;

  /**
   * Additional environment variables to pass to the gsd process.
   * Merged with process.env. Caller-supplied keys override inherited env.
   */
  env?: Record<string, string>;

  /**
   * When true, the --auto flag is forwarded to gsd headless.
   * @default true
   */
  autoMode?: boolean;
}

/**
 * Result returned by runGsdHeadless after the process exits or times out.
 */
export interface GsdHeadlessResult {
  /** Exit code reported by gsd, or null if the process was killed before exit. */
  exitCode: number | null;

  /** True when the process was terminated because timeoutMs was exceeded. */
  timedOut: boolean;

  /** Wall-clock duration in milliseconds from spawn to exit/kill. */
  durationMs: number;
}
