import { TASK_BRANCH_PREFIX } from "@optio/shared";
import { retrieveSecretWithFallback } from "./secret-service.js";
import { logger } from "../logger.js";

export interface ExistingPr {
  url: string;
  number: number;
  state: string;
}

/**
 * Extract owner and repo from a normalized repo URL.
 * e.g. "https://github.com/owner/repo" → { owner: "owner", repo: "repo" }
 */
export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Check if an open PR already exists for a task's branch.
 *
 * Uses the GitHub API: GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open
 * Branch naming is deterministic: `optio/task-{taskId}`
 *
 * Returns the PR info if found, or null if no PR exists.
 */
export async function checkExistingPr(
  repoUrl: string,
  taskId: string,
  workspaceId: string | null,
): Promise<ExistingPr | null> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) {
    logger.debug({ repoUrl }, "Cannot parse owner/repo from URL — skipping PR check");
    return null;
  }

  let githubToken: string | null = null;
  try {
    githubToken = await retrieveSecretWithFallback("GITHUB_TOKEN", "global", workspaceId);
  } catch {
    logger.debug("No GITHUB_TOKEN available — skipping existing PR check");
    return null;
  }
  if (!githubToken) return null;

  const branch = `${TASK_BRANCH_PREFIX}${taskId}`;
  const { owner, repo } = parsed;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "User-Agent": "Optio",
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!res.ok) {
      logger.debug({ status: res.status }, "GitHub API error checking for existing PR");
      return null;
    }

    const pulls = (await res.json()) as Array<{
      html_url: string;
      number: number;
      state: string;
    }>;

    if (pulls.length === 0) return null;

    // Return the first (most relevant) open PR for this branch
    const pr = pulls[0];
    return {
      url: pr.html_url,
      number: pr.number,
      state: pr.state,
    };
  } catch (err) {
    logger.debug({ err }, "Failed to check for existing PR");
    return null;
  }
}
