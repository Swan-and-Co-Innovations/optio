import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockListActions = vi.fn();
const mockListActionTypes = vi.fn();

vi.mock("../services/optio-action-service.js", () => ({
  listActions: (...args: unknown[]) => mockListActions(...args),
  listActionTypes: (...args: unknown[]) => mockListActionTypes(...args),
}));

vi.mock("../plugins/auth.js", () => ({
  requireRole: () => async () => {},
}));

import { optioActionRoutes } from "./optio-actions.js";

// ─── Helpers ───

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("user", undefined as any);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as any).user = { id: "user-1", workspaceId: "ws-1" };
    done();
  });
  await optioActionRoutes(app);
  await app.ready();
  return app;
}

describe("GET /api/optio/actions", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns paginated actions", async () => {
    mockListActions.mockResolvedValue({
      actions: [
        {
          id: "a1",
          action: "retry_task",
          success: true,
          createdAt: "2026-03-27T10:00:00Z",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const res = await app.inject({ method: "GET", url: "/api/optio/actions" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actions).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("passes filter params to service", async () => {
    mockListActions.mockResolvedValue({
      actions: [],
      total: 0,
      limit: 10,
      offset: 0,
    });

    await app.inject({
      method: "GET",
      url: "/api/optio/actions?action=retry_task&limit=10&offset=5",
    });

    expect(mockListActions).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        action: "retry_task",
        limit: 10,
        offset: 5,
      }),
    );
  });

  it("returns 400 for invalid limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions?limit=999",
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/optio/actions/types", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns action types", async () => {
    mockListActionTypes.mockResolvedValue(["retry_task", "bulk_cancel_active"]);

    const res = await app.inject({ method: "GET", url: "/api/optio/actions/types" });

    expect(res.statusCode).toBe(200);
    expect(res.json().types).toEqual(["retry_task", "bulk_cancel_active"]);
  });
});
