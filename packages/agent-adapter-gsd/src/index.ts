import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { GsdHeadlessConfig, GsdHeadlessResult } from "./types.js";

export type { GsdHeadlessConfig, GsdHeadlessResult } from "./types.js";

/**
 * Spawns `gsd headless [--auto]` in the given workspace and waits for it to
 * exit, handling timeout via AbortController.
 *
 * Security notes:
 * - ANTHROPIC_API_KEY is forwarded from process.env automatically via env
 *   inheritance; it is never logged or echoed.
 * - Caller-supplied `config.env` is merged after inheritance, allowing
 *   selective overrides without requiring the caller to re-supply secrets.
 */
export async function runGsdHeadless(
  config: GsdHeadlessConfig
): Promise<GsdHeadlessResult> {
  const {
    workspacePath,
    timeoutMs = 600_000,
    env: extraEnv = {},
    autoMode = true,
  } = config;

  // ── Validate workspace ────────────────────────────────────────────────────
  try {
    const s = await stat(workspacePath);
    if (!s.isDirectory()) {
      throw new Error(`workspacePath is not a directory: ${workspacePath}`);
    }
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : String(err);
    throw new Error(`runGsdHeadless: invalid workspacePath — ${msg}`);
  }

  // ── Build gsd arguments ───────────────────────────────────────────────────
  const args = ["headless"];
  if (autoMode) {
    args.push("--auto");
  }

  // ── Merge environment ─────────────────────────────────────────────────────
  // Inherit the full process environment (includes ANTHROPIC_API_KEY, PATH,
  // etc.) then layer caller overrides on top.  The key is never logged.
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };

  // ── Timeout via AbortController ───────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startMs = Date.now();
  let timedOut = false;

  return new Promise<GsdHeadlessResult>((resolve, reject) => {
    const child = spawn("gsd", args, {
      cwd: workspacePath,
      env: mergedEnv,
      stdio: "inherit",
      signal: controller.signal,
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.name === "AbortError" || controller.signal.aborted) {
        timedOut = true;
        resolve({
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - startMs,
        });
      } else {
        reject(new Error(`runGsdHeadless: spawn error — ${err.message}`));
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        durationMs: Date.now() - startMs,
      });
    });
  });
}
