import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    selectDistinct: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  optioActions: {
    id: "id",
    userId: "user_id",
    action: "action",
    params: "params",
    result: "result",
    success: "success",
    conversationSnippet: "conversation_snippet",
    workspaceId: "workspace_id",
    createdAt: "created_at",
  },
  users: {
    id: "id",
    displayName: "display_name",
    email: "email",
    avatarUrl: "avatar_url",
  },
}));

import { db } from "../db/client.js";
import { logAction, listActions, listActionTypes } from "./optio-action-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logAction", () => {
  it("inserts an action and returns it", async () => {
    const mockAction = {
      id: "action-1",
      userId: "user-1",
      action: "retry_task",
      params: { taskId: "task-1" },
      result: { success: true },
      success: true,
      conversationSnippet: null,
      workspaceId: "ws-1",
      createdAt: new Date(),
    };
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockAction]),
      }),
    });

    const result = await logAction({
      userId: "user-1",
      action: "retry_task",
      params: { taskId: "task-1" },
      result: { success: true },
      success: true,
      workspaceId: "ws-1",
    });

    expect(result).toEqual(mockAction);
  });

  it("sanitizes sensitive params", async () => {
    const mockAction = {
      id: "action-2",
      userId: "user-1",
      action: "update_secret",
      params: { name: "test", token: "[REDACTED]" },
      result: { success: true },
      success: true,
      conversationSnippet: null,
      workspaceId: "ws-1",
      createdAt: new Date(),
    };

    const insertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([mockAction]),
    });
    (db.insert as any).mockReturnValue({ values: insertValues });

    await logAction({
      userId: "user-1",
      action: "update_secret",
      params: { name: "test", token: "super-secret-value" },
      success: true,
      workspaceId: "ws-1",
    });

    // Verify the params were sanitized before insertion
    const calledWith = insertValues.mock.calls[0][0];
    expect(calledWith.params.token).toBe("[REDACTED]");
    expect(calledWith.params.name).toBe("test");
  });
});

describe("listActions", () => {
  it("returns actions with user info and pagination", async () => {
    const rows = [
      {
        id: "a1",
        userId: "u1",
        action: "retry_task",
        params: { taskId: "t1" },
        result: { success: true },
        success: true,
        conversationSnippet: null,
        workspaceId: "ws-1",
        createdAt: new Date("2026-01-01"),
        userName: "Alice",
        userEmail: "alice@example.com",
        userAvatar: "https://example.com/avatar.png",
      },
    ];

    const mockOffset = vi.fn().mockResolvedValue(rows);
    const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });

    (db.select as any).mockImplementation((...args: any[]) => {
      // Handle the count query (second select call)
      if (args.length > 0 && args[0]?.count) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        };
      }
      return { from: mockFrom };
    });

    const result = await listActions({ workspaceId: "ws-1" });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].user).toEqual({
      id: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result.total).toBe(1);
  });
});

describe("listActionTypes", () => {
  it("returns distinct action names", async () => {
    const rows = [{ action: "bulk_cancel_active" }, { action: "retry_task" }];
    (db.selectDistinct as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows),
        }),
      }),
    });

    const result = await listActionTypes("ws-1");

    expect(result).toEqual(["bulk_cancel_active", "retry_task"]);
  });
});
