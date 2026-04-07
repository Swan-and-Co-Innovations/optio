import { DEFAULT_STALL_THRESHOLD_MS } from "../constants.js";

/**
 * Pure function to check if a task is stalled based on its lastActivityAt
 * timestamp and a configurable threshold.
 */
export function isTaskStalled(
  task: { state: string; lastActivityAt?: Date | string | null },
  now: Date = new Date(),
  thresholdMs: number = DEFAULT_STALL_THRESHOLD_MS,
): boolean {
  if (task.state !== "running") return false;
  if (!task.lastActivityAt) return false;

  const lastActivity =
    task.lastActivityAt instanceof Date ? task.lastActivityAt : new Date(task.lastActivityAt);
  const silentForMs = now.getTime() - lastActivity.getTime();
  return silentForMs >= thresholdMs;
}

/**
 * Compute how long a task has been silent (in ms).
 * Returns 0 if lastActivityAt is not set or the task is not running.
 */
export function getSilentDuration(
  task: { state: string; lastActivityAt?: Date | string | null },
  now: Date = new Date(),
): number {
  if (task.state !== "running") return 0;
  if (!task.lastActivityAt) return 0;

  const lastActivity =
    task.lastActivityAt instanceof Date ? task.lastActivityAt : new Date(task.lastActivityAt);
  return Math.max(0, now.getTime() - lastActivity.getTime());
}
