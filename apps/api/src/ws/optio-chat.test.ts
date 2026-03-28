import { describe, it, expect, beforeEach } from "vitest";
import {
  toolRequiresConfirmation,
  buildToolDefinitionsBlock,
  buildSystemPrompt,
  parseActionProposal,
  parseActionResult,
  _resetActiveConnections,
  _resetPodCache,
} from "./optio-chat.js";

describe("optio-chat", () => {
  beforeEach(() => {
    _resetActiveConnections();
    _resetPodCache();
  });

  // ─── toolRequiresConfirmation ───

  describe("toolRequiresConfirmation", () => {
    it("returns true for write tool prefixes", () => {
      expect(toolRequiresConfirmation("create_task")).toBe(true);
      expect(toolRequiresConfirmation("retry_task")).toBe(true);
      expect(toolRequiresConfirmation("cancel_task")).toBe(true);
      expect(toolRequiresConfirmation("update_repo")).toBe(true);
      expect(toolRequiresConfirmation("bulk_retry")).toBe(true);
      expect(toolRequiresConfirmation("assign_issue")).toBe(true);
      expect(toolRequiresConfirmation("delete_repo")).toBe(true);
      expect(toolRequiresConfirmation("restart_pod")).toBe(true);
      expect(toolRequiresConfirmation("manage_secrets")).toBe(true);
      expect(toolRequiresConfirmation("manage_schedules")).toBe(true);
    });

    it("returns false for read tool prefixes", () => {
      expect(toolRequiresConfirmation("list_tasks")).toBe(false);
      expect(toolRequiresConfirmation("get_task_details")).toBe(false);
      expect(toolRequiresConfirmation("get_cost_analytics")).toBe(false);
      expect(toolRequiresConfirmation("get_cluster_status")).toBe(false);
      expect(toolRequiresConfirmation("list_repos")).toBe(false);
      expect(toolRequiresConfirmation("list_issues")).toBe(false);
      expect(toolRequiresConfirmation("list_pods")).toBe(false);
    });
  });

  // ─── buildToolDefinitionsBlock ───

  describe("buildToolDefinitionsBlock", () => {
    it("returns all tools when enabledTools is empty", () => {
      const block = buildToolDefinitionsBlock([]);
      expect(block).toContain("list_tasks");
      expect(block).toContain("create_task");
      expect(block).toContain("get_cost_analytics");
      expect(block).toContain("manage_secrets");
    });

    it("filters to only enabled tools", () => {
      const block = buildToolDefinitionsBlock(["list_tasks", "retry_task"]);
      expect(block).toContain("list_tasks");
      expect(block).toContain("retry_task");
      expect(block).not.toContain("create_task");
      expect(block).not.toContain("manage_secrets");
    });

    it("includes requiresConfirmation tag", () => {
      const block = buildToolDefinitionsBlock(["list_tasks", "create_task"]);
      expect(block).toContain("list_tasks: List and search tasks [requiresConfirmation: false]");
      expect(block).toContain("create_task: Create a new task [requiresConfirmation: true]");
    });
  });

  // ─── buildSystemPrompt ───

  describe("buildSystemPrompt", () => {
    it("includes Optio persona", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "",
        enabledTools: [],
        confirmWrites: true,
      });
      expect(prompt).toContain("You are Optio");
      expect(prompt).toContain("operations assistant");
    });

    it("includes tool definitions", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "",
        enabledTools: [],
        confirmWrites: true,
      });
      expect(prompt).toContain("Available Operations");
      expect(prompt).toContain("list_tasks");
    });

    it("includes action proposal format when confirmWrites is true", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "",
        enabledTools: [],
        confirmWrites: true,
      });
      expect(prompt).toContain("ACTION_PROPOSAL");
      expect(prompt).toContain("Wait for the user to approve");
    });

    it("omits action proposal format when confirmWrites is false", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "",
        enabledTools: [],
        confirmWrites: false,
      });
      expect(prompt).not.toContain("ACTION_PROPOSAL");
      expect(prompt).not.toContain("Wait for the user to approve");
    });

    it("appends custom system prompt", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "Always respond in Japanese.",
        enabledTools: [],
        confirmWrites: true,
      });
      expect(prompt).toContain("Additional Instructions");
      expect(prompt).toContain("Always respond in Japanese.");
    });

    it("omits additional instructions when systemPrompt is empty", () => {
      const prompt = buildSystemPrompt({
        systemPrompt: "",
        enabledTools: [],
        confirmWrites: true,
      });
      expect(prompt).not.toContain("Additional Instructions");
    });
  });

  // ─── parseActionProposal ───

  describe("parseActionProposal", () => {
    it("parses a valid action proposal", () => {
      const text = `I'd like to do the following:

ACTION_PROPOSAL: {"description": "Retry 3 failed tasks", "items": ["Retry task #201", "Retry task #203"]}

Let me know if this looks good.`;

      const result = parseActionProposal(text);
      expect(result).not.toBeNull();
      expect(result!.description).toBe("Retry 3 failed tasks");
      expect(result!.items).toEqual(["Retry task #201", "Retry task #203"]);
    });

    it("returns null for text without proposal", () => {
      const text = "Here are your running tasks: task-1, task-2, task-3.";
      expect(parseActionProposal(text)).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const text = "ACTION_PROPOSAL: {not valid json}";
      expect(parseActionProposal(text)).toBeNull();
    });

    it("returns null when JSON lacks required fields", () => {
      const text = 'ACTION_PROPOSAL: {"description": "test"}';
      expect(parseActionProposal(text)).toBeNull();
    });

    it("returns null when items is not an array", () => {
      const text = 'ACTION_PROPOSAL: {"description": "test", "items": "not-array"}';
      expect(parseActionProposal(text)).toBeNull();
    });
  });

  // ─── parseActionResult ───

  describe("parseActionResult", () => {
    it("parses a valid action result", () => {
      const text = `Done!

ACTION_RESULT: {"success": true, "summary": "Retried 3 tasks successfully"}`;

      const result = parseActionResult(text);
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.summary).toBe("Retried 3 tasks successfully");
    });

    it("parses a failure result", () => {
      const text =
        'ACTION_RESULT: {"success": false, "summary": "Failed to cancel task #201: not running"}';
      const result = parseActionResult(text);
      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.summary).toContain("Failed to cancel");
    });

    it("returns null for text without result", () => {
      const text = "I completed the operation.";
      expect(parseActionResult(text)).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      const text = "ACTION_RESULT: {invalid}";
      expect(parseActionResult(text)).toBeNull();
    });

    it("returns null when required fields are missing", () => {
      const text = 'ACTION_RESULT: {"success": true}';
      expect(parseActionResult(text)).toBeNull();
    });
  });
});
