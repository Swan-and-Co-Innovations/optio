import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockGetTask = vi.fn();
const mockRecordTaskEvent = vi.fn();

vi.mock("../services/task-service.js", () => ({
  getTask: (...args: unknown[]) => mockGetTask(...args),
  recordTaskEvent: (...args: unknown[]) => mockRecordTaskEvent(...args),
}));

const mockSendMessage = vi.fn();
const mockListMessages = vi.fn();
const mockCanMessageTask = vi.fn();

vi.mock("../services/task-message-service.js", () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  canMessageTask: (...args: unknown[]) => mockCanMessageTask(...args),
}));

const mockPublishTaskMessage = vi.fn();
vi.mock("../services/task-message-bus.js", () => ({
  publishTaskMessage: (...args: unknown[]) => mockPublishTaskMessage(...args),
}));

const mockPublishEvent = vi.fn();
const mockGetRedisClient = vi.fn();
vi.mock("../services/event-bus.js", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
  getRedisClient: () => mockGetRedisClient(),
}));

import { messageRoutes } from "./messages.js";

// ─── Helpers ───

async function buildTestApp(userOverrides?: Record<string, unknown>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("user", undefined as any);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as any).user = {
      id: "user-1",
      displayName: "Test User",
      workspaceId: "ws-1",
      ...userOverrides,
    };
    done();
  });
  await messageRoutes(app);
  await app.ready();
  return app;
}

const runningClaudeTask = {
  id: "task-1",
  state: "running",
  agentType: "claude-code",
  workspaceId: "ws-1",
  createdBy: "user-1",
};

describe("POST /api/tasks/:id/message", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Mock Redis client for rate limiting
    mockGetRedisClient.mockReturnValue({
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    });
    app = await buildTestApp();
  });

  it("sends a message and returns 202", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);
    mockCanMessageTask.mockResolvedValue(true);
    const mockMsg = {
      id: "msg-1",
      taskId: "task-1",
      userId: "user-1",
      content: "use Postgres",
      mode: "soft",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      deliveredAt: null,
      ackedAt: null,
    };
    mockSendMessage.mockResolvedValue(mockMsg);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "use Postgres" },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.message.id).toBe("msg-1");
    expect(body.message.content).toBe("use Postgres");
    expect(body.message.mode).toBe("soft");
    expect(body.message.deliveredAt).toBeNull();
    expect(mockPublishTaskMessage).toHaveBeenCalled();
    expect(mockPublishEvent).toHaveBeenCalled();
    expect(mockRecordTaskEvent).toHaveBeenCalled();
  });

  it("sends an interrupt message", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);
    mockCanMessageTask.mockResolvedValue(true);
    const mockMsg = {
      id: "msg-2",
      taskId: "task-1",
      userId: "user-1",
      content: "STOP",
      mode: "interrupt",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      deliveredAt: null,
      ackedAt: null,
    };
    mockSendMessage.mockResolvedValue(mockMsg);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "STOP", mode: "interrupt" },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().message.mode).toBe("interrupt");
  });

  it("returns 404 when task not found", async () => {
    mockGetTask.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/nonexistent/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when task is in different workspace", async () => {
    mockGetTask.mockResolvedValue({ ...runningClaudeTask, workspaceId: "ws-other" });

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when user cannot message task", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);
    mockCanMessageTask.mockResolvedValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when task is not running", async () => {
    mockGetTask.mockResolvedValue({ ...runningClaudeTask, state: "completed" });
    mockCanMessageTask.mockResolvedValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 501 for non-claude-code agent", async () => {
    mockGetTask.mockResolvedValue({ ...runningClaudeTask, agentType: "codex" });
    mockCanMessageTask.mockResolvedValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);
    mockCanMessageTask.mockResolvedValue(true);
    mockGetRedisClient.mockReturnValue({
      incr: vi.fn().mockResolvedValue(11),
      expire: vi.fn().mockResolvedValue(1),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "hello" },
    });

    expect(res.statusCode).toBe(429);
  });

  it("validates content length", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/task-1/message",
      payload: { content: "" },
    });

    // Zod validation error returns 400 via error handler or
    // could throw - check for non-2xx
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("GET /api/tasks/:id/messages", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue({
      incr: vi.fn(),
      expire: vi.fn(),
    });
    app = await buildTestApp();
  });

  it("lists messages for a task", async () => {
    mockGetTask.mockResolvedValue(runningClaudeTask);
    mockListMessages.mockResolvedValue([
      {
        id: "m1",
        taskId: "task-1",
        userId: "user-1",
        content: "hello",
        mode: "soft",
        createdAt: new Date("2026-01-01"),
        deliveredAt: null,
        ackedAt: null,
        deliveryError: null,
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/task-1/messages",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(1);
  });

  it("returns 404 for nonexistent task", async () => {
    mockGetTask.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/nonexistent/messages",
    });

    expect(res.statusCode).toBe(404);
  });
});
