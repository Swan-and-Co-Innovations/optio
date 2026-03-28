import { db } from "../db/client.js";
import { tasks, repos, repoPods } from "../db/schema.js";
import { eq, sql, and, gte, desc } from "drizzle-orm";

// ── Tool definitions with confirmation flags ──────────────────────────────────

export interface OptioChatTool {
  name: string;
  description: string;
  requiresConfirmation: boolean;
}

export const OPTIO_TOOLS: OptioChatTool[] = [
  // Read-only — no confirmation
  {
    name: "list_tasks",
    description: "List tasks, optionally filtered by state or repo",
    requiresConfirmation: false,
  },
  {
    name: "get_task",
    description: "Get details of a specific task by ID",
    requiresConfirmation: false,
  },
  {
    name: "get_task_logs",
    description: "Get logs for a specific task",
    requiresConfirmation: false,
  },
  {
    name: "list_repos",
    description: "List all configured repositories",
    requiresConfirmation: false,
  },
  {
    name: "get_repo",
    description: "Get details of a specific repository",
    requiresConfirmation: false,
  },
  {
    name: "get_cluster_status",
    description: "Get cluster pod/node status",
    requiresConfirmation: false,
  },
  {
    name: "get_analytics",
    description: "Get cost analytics and usage data",
    requiresConfirmation: false,
  },
  { name: "list_sessions", description: "List interactive sessions", requiresConfirmation: false },

  // Write operations — require confirmation
  {
    name: "create_task",
    description: "Create a new task for a repository",
    requiresConfirmation: true,
  },
  {
    name: "retry_task",
    description: "Retry a failed or cancelled task",
    requiresConfirmation: true,
  },
  {
    name: "cancel_task",
    description: "Cancel a running or queued task",
    requiresConfirmation: true,
  },
  { name: "bulk_retry_failed", description: "Retry all failed tasks", requiresConfirmation: true },
  {
    name: "bulk_cancel_active",
    description: "Cancel all running and queued tasks",
    requiresConfirmation: true,
  },
  {
    name: "assign_issue",
    description: "Assign a GitHub issue to Optio",
    requiresConfirmation: true,
  },
  {
    name: "update_repo_settings",
    description: "Update repository configuration",
    requiresConfirmation: true,
  },
];

const READ_TOOLS = OPTIO_TOOLS.filter((t) => !t.requiresConfirmation).map((t) => t.name);
const WRITE_TOOLS = OPTIO_TOOLS.filter((t) => t.requiresConfirmation).map((t) => t.name);

// ── Action proposal parsing ──────────────────────────────────────────────────

export interface ActionProposal {
  description: string;
  details: string;
}

const PROPOSAL_START = "<optio_action_proposal>";
const PROPOSAL_END = "</optio_action_proposal>";

/**
 * Parse action proposals from agent text output.
 * Returns extracted proposals and the text with proposals removed.
 */
export function parseActionProposals(text: string): {
  proposals: ActionProposal[];
  cleanText: string;
} {
  const proposals: ActionProposal[] = [];
  let cleanText = text;

  let startIdx = cleanText.indexOf(PROPOSAL_START);
  while (startIdx !== -1) {
    const endIdx = cleanText.indexOf(PROPOSAL_END, startIdx);
    if (endIdx === -1) break;

    const jsonStr = cleanText.slice(startIdx + PROPOSAL_START.length, endIdx).trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        proposals.push({
          description: item.description ?? "Unknown action",
          details: item.details ?? "",
        });
      }
    } catch {
      // If JSON parsing fails, treat the whole block as a single proposal
      proposals.push({ description: jsonStr.slice(0, 200), details: "" });
    }

    cleanText = cleanText.slice(0, startIdx) + cleanText.slice(endIdx + PROPOSAL_END.length);
    startIdx = cleanText.indexOf(PROPOSAL_START);
  }

  return { proposals, cleanText: cleanText.trim() };
}

// ── System status ─────────────────────────────────────────────────────────────

export interface SystemStatus {
  tasks: {
    running: number;
    queued: number;
    failed: number;
    prOpened: number;
    completed: number;
    total: number;
  };
  recentFailures: {
    id: string;
    title: string;
    repoUrl: string;
    errorMessage: string | null;
    failedAt: string;
  }[];
  repos: { repoUrl: string; fullName: string; activeTasks: number }[];
  pods: { podName: string | null; repoUrl: string; state: string; activeTaskCount: number }[];
  maxConcurrent: number;
}

/**
 * Fetch live system status from the database.
 * This is included in the system prompt for each agent invocation.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  // Task counts by state
  const stateCounts = await db
    .select({
      state: tasks.state,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .groupBy(tasks.state);

  const countMap: Record<string, number> = {};
  let total = 0;
  for (const row of stateCounts) {
    countMap[row.state] = row.count;
    total += row.count;
  }

  // Recent failures (last 24h, max 10)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentFailures = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      repoUrl: tasks.repoUrl,
      errorMessage: tasks.errorMessage,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.state, "failed"), gte(tasks.updatedAt, oneDayAgo)))
    .orderBy(desc(tasks.updatedAt))
    .limit(10);

  // Active repos with task counts
  const activeRepos = await db
    .select({
      repoUrl: repos.repoUrl,
      fullName: repos.fullName,
      activeTasks: sql<number>`(
        SELECT count(*)::int FROM tasks
        WHERE tasks.repo_url = repos.repo_url
        AND tasks.state IN ('running', 'queued', 'provisioning')
      )`,
    })
    .from(repos)
    .limit(20);

  // Pod status
  const podStatus = await db
    .select({
      podName: repoPods.podName,
      repoUrl: repoPods.repoUrl,
      state: repoPods.state,
      activeTaskCount: repoPods.activeTaskCount,
    })
    .from(repoPods)
    .limit(20);

  const maxConcurrent = parseInt(process.env.OPTIO_MAX_CONCURRENT ?? "5", 10);

  return {
    tasks: {
      running: countMap["running"] ?? 0,
      queued: countMap["queued"] ?? 0,
      failed: countMap["failed"] ?? 0,
      prOpened: countMap["pr_opened"] ?? 0,
      completed: countMap["completed"] ?? 0,
      total,
    },
    recentFailures: recentFailures.map((f) => ({
      id: f.id,
      title: f.title,
      repoUrl: f.repoUrl,
      errorMessage: f.errorMessage,
      failedAt: f.updatedAt.toISOString(),
    })),
    repos: activeRepos.map((r) => ({
      repoUrl: r.repoUrl,
      fullName: r.fullName,
      activeTasks: r.activeTasks,
    })),
    pods: podStatus.map((p) => ({
      podName: p.podName,
      repoUrl: p.repoUrl,
      state: p.state,
      activeTaskCount: p.activeTaskCount,
    })),
    maxConcurrent,
  };
}

// ── System prompt builder ─────────────────────────────────────────────────────

/**
 * Build the system prompt for the Optio chat agent.
 * Includes persona, tool definitions, live system status, and action formatting rules.
 */
export function buildSystemPrompt(status: SystemStatus, apiBaseUrl: string): string {
  const toolList = OPTIO_TOOLS.map(
    (t) =>
      `- ${t.name}: ${t.description} [${t.requiresConfirmation ? "REQUIRES CONFIRMATION" : "read-only"}]`,
  ).join("\n");

  const statusJson = JSON.stringify(status, null, 2);

  return `You are Optio, an AI assistant that helps users manage AI coding tasks and workflows.
You have access to the Optio API at ${apiBaseUrl} and can perform operations on behalf of the user.

## Available Actions

${toolList}

## Current System Status

\`\`\`json
${statusJson}
\`\`\`

## How to Perform Actions

### Read Operations
For read-only operations (list_tasks, get_task, get_task_logs, list_repos, etc.), use your Bash tool to call the Optio API directly. The API is available at ${apiBaseUrl}. Examples:
- \`curl -s ${apiBaseUrl}/api/tasks?state=failed | jq .\`
- \`curl -s ${apiBaseUrl}/api/tasks/TASK_ID | jq .\`
- \`curl -s ${apiBaseUrl}/api/analytics/costs?days=7 | jq .\`

### Write Operations
For write operations (create_task, retry_task, cancel_task, bulk operations, etc.), you MUST propose them first. Output your proposal in this exact format:

${PROPOSAL_START}
[
  { "description": "Short human-readable description", "details": "Technical details of the API call" }
]
${PROPOSAL_END}

Do NOT execute write operations until the user explicitly approves. After approval, execute the operation using curl.

## Guidelines
- Be concise and helpful
- Use the system status above to answer questions without making API calls when possible
- When listing tasks or showing data, format it clearly
- For failures, examine error messages and suggest specific remedies
- When proposing actions, be specific about what will happen (e.g., "Retry 3 failed tasks: #abc, #def, #ghi")
- If you need more data than what's in the system status, use curl to fetch it`;
}

// ── Concurrency tracking ──────────────────────────────────────────────────────

/** Track active conversations per user (in-memory, resets on restart). */
const activeConversations = new Map<string, boolean>();

export function isUserActive(userId: string): boolean {
  return activeConversations.get(userId) === true;
}

export function setUserActive(userId: string, active: boolean): void {
  if (active) {
    activeConversations.set(userId, true);
  } else {
    activeConversations.delete(userId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.includes(toolName);
}

export function isReadTool(toolName: string): boolean {
  return READ_TOOLS.includes(toolName);
}
