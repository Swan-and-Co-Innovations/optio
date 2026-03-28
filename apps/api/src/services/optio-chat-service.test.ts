import { describe, it, expect, beforeEach } from "vitest";
import {
  parseActionProposals,
  buildSystemPrompt,
  isUserActive,
  setUserActive,
  isWriteTool,
  isReadTool,
  OPTIO_TOOLS,
  type SystemStatus,
} from "./optio-chat-service.js";

describe("parseActionProposals", () => {
  it("extracts a single action proposal", () => {
    const text = `I'll retry the failed tasks.

<optio_action_proposal>
[{ "description": "Retry 3 failed tasks", "details": "POST /api/tasks/bulk/retry-failed" }]
</optio_action_proposal>

Let me know if you want to proceed.`;

    const { proposals, cleanText } = parseActionProposals(text);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].description).toBe("Retry 3 failed tasks");
    expect(proposals[0].details).toBe("POST /api/tasks/bulk/retry-failed");
    expect(cleanText).not.toContain("optio_action_proposal");
    expect(cleanText).toContain("retry the failed tasks");
  });

  it("extracts multiple action proposals in one block", () => {
    const text = `<optio_action_proposal>
[
  { "description": "Cancel task #abc", "details": "POST /api/tasks/abc/cancel" },
  { "description": "Cancel task #def", "details": "POST /api/tasks/def/cancel" }
]
</optio_action_proposal>`;

    const { proposals } = parseActionProposals(text);
    expect(proposals).toHaveLength(2);
    expect(proposals[0].description).toBe("Cancel task #abc");
    expect(proposals[1].description).toBe("Cancel task #def");
  });

  it("handles a single object (not array)", () => {
    const text = `<optio_action_proposal>
{ "description": "Create a task", "details": "POST /api/tasks" }
</optio_action_proposal>`;

    const { proposals } = parseActionProposals(text);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].description).toBe("Create a task");
  });

  it("returns empty proposals when no markers found", () => {
    const text = "Just a regular response with no proposals.";
    const { proposals, cleanText } = parseActionProposals(text);
    expect(proposals).toHaveLength(0);
    expect(cleanText).toBe(text);
  });

  it("handles malformed JSON gracefully", () => {
    const text = `<optio_action_proposal>
this is not json at all
</optio_action_proposal>`;

    const { proposals } = parseActionProposals(text);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].description).toBe("this is not json at all");
    expect(proposals[0].details).toBe("");
  });

  it("handles unclosed proposal tag", () => {
    const text = `Some text <optio_action_proposal> [{"description": "test"}] but no end tag`;
    const { proposals, cleanText } = parseActionProposals(text);
    expect(proposals).toHaveLength(0);
    expect(cleanText).toBe(text);
  });

  it("extracts multiple separate proposal blocks", () => {
    const text = `First: <optio_action_proposal>
[{ "description": "Action A", "details": "detail A" }]
</optio_action_proposal>
Then: <optio_action_proposal>
[{ "description": "Action B", "details": "detail B" }]
</optio_action_proposal>`;

    const { proposals } = parseActionProposals(text);
    expect(proposals).toHaveLength(2);
    expect(proposals[0].description).toBe("Action A");
    expect(proposals[1].description).toBe("Action B");
  });
});

describe("buildSystemPrompt", () => {
  const mockStatus: SystemStatus = {
    tasks: { running: 2, queued: 3, failed: 1, prOpened: 4, completed: 50, total: 60 },
    recentFailures: [
      {
        id: "task-1",
        title: "Fix auth bug",
        repoUrl: "https://github.com/org/repo",
        errorMessage: "OOM",
        failedAt: "2026-03-28T10:00:00Z",
      },
    ],
    repos: [{ repoUrl: "https://github.com/org/repo", fullName: "org/repo", activeTasks: 2 }],
    pods: [
      {
        podName: "optio-pod-abc",
        repoUrl: "https://github.com/org/repo",
        state: "ready",
        activeTaskCount: 2,
      },
    ],
    maxConcurrent: 5,
  };

  it("includes tool definitions", () => {
    const prompt = buildSystemPrompt(mockStatus, "http://localhost:4000");
    expect(prompt).toContain("list_tasks");
    expect(prompt).toContain("retry_task");
    expect(prompt).toContain("REQUIRES CONFIRMATION");
    expect(prompt).toContain("read-only");
  });

  it("includes system status", () => {
    const prompt = buildSystemPrompt(mockStatus, "http://localhost:4000");
    expect(prompt).toContain('"running": 2');
    expect(prompt).toContain('"failed": 1');
    expect(prompt).toContain("Fix auth bug");
    expect(prompt).toContain("OOM");
  });

  it("includes API base URL", () => {
    const prompt = buildSystemPrompt(mockStatus, "http://api:4000");
    expect(prompt).toContain("http://api:4000");
    expect(prompt).toContain("curl -s http://api:4000/api/tasks");
  });

  it("includes action proposal format instructions", () => {
    const prompt = buildSystemPrompt(mockStatus, "http://localhost:4000");
    expect(prompt).toContain("<optio_action_proposal>");
    expect(prompt).toContain("</optio_action_proposal>");
    expect(prompt).toContain("Do NOT execute write operations");
  });
});

describe("concurrency tracking", () => {
  beforeEach(() => {
    // Reset state
    setUserActive("user-1", false);
    setUserActive("user-2", false);
  });

  it("tracks active users", () => {
    expect(isUserActive("user-1")).toBe(false);
    setUserActive("user-1", true);
    expect(isUserActive("user-1")).toBe(true);
  });

  it("removes user on deactivate", () => {
    setUserActive("user-1", true);
    setUserActive("user-1", false);
    expect(isUserActive("user-1")).toBe(false);
  });

  it("tracks multiple users independently", () => {
    setUserActive("user-1", true);
    setUserActive("user-2", true);
    expect(isUserActive("user-1")).toBe(true);
    expect(isUserActive("user-2")).toBe(true);

    setUserActive("user-1", false);
    expect(isUserActive("user-1")).toBe(false);
    expect(isUserActive("user-2")).toBe(true);
  });
});

describe("tool classification", () => {
  it("classifies read tools correctly", () => {
    expect(isReadTool("list_tasks")).toBe(true);
    expect(isReadTool("get_task")).toBe(true);
    expect(isReadTool("get_task_logs")).toBe(true);
    expect(isReadTool("list_repos")).toBe(true);
    expect(isReadTool("get_analytics")).toBe(true);
  });

  it("classifies write tools correctly", () => {
    expect(isWriteTool("create_task")).toBe(true);
    expect(isWriteTool("retry_task")).toBe(true);
    expect(isWriteTool("cancel_task")).toBe(true);
    expect(isWriteTool("bulk_retry_failed")).toBe(true);
    expect(isWriteTool("bulk_cancel_active")).toBe(true);
    expect(isWriteTool("assign_issue")).toBe(true);
  });

  it("read tools are not write tools", () => {
    expect(isWriteTool("list_tasks")).toBe(false);
    expect(isReadTool("create_task")).toBe(false);
  });

  it("unknown tools are neither", () => {
    expect(isReadTool("unknown_tool")).toBe(false);
    expect(isWriteTool("unknown_tool")).toBe(false);
  });

  it("all tools are classified", () => {
    for (const tool of OPTIO_TOOLS) {
      if (tool.requiresConfirmation) {
        expect(isWriteTool(tool.name)).toBe(true);
      } else {
        expect(isReadTool(tool.name)).toBe(true);
      }
    }
  });
});
