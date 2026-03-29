import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockRetrieveSecret = vi.fn();
vi.mock("../services/secret-service.js", () => ({
  retrieveSecret: (...args: unknown[]) => mockRetrieveSecret(...args),
}));

const mockDbSelect = vi.fn();
vi.mock("../db/client.js", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  repos: { id: "id", workspaceId: "workspaceId" },
  tasks: {
    ticketSource: "ticketSource",
    ticketExternalId: "ticketExternalId",
    id: "id",
    state: "state",
    workspaceId: "workspaceId",
  },
}));

vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mockCreateTask = vi.fn();
const mockTransitionTask = vi.fn();
vi.mock("../services/task-service.js", () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  transitionTask: (...args: unknown[]) => mockTransitionTask(...args),
}));

const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock("../workers/task-worker.js", () => ({
  taskQueue: {
    add: (...args: unknown[]) => mockQueueAdd(...args),
  },
}));

import { issueRoutes } from "./issues.js";

// ─── Helpers ───

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("user", undefined as any);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as any).user = { workspaceId: "ws-1" };
    done();
  });
  await issueRoutes(app);
  await app.ready();
  return app;
}

describe("GET /api/issues", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when no GitHub token is configured", async () => {
    mockRetrieveSecret.mockRejectedValue(new Error("not found"));

    const res = await app.inject({ method: "GET", url: "/api/issues" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("No GitHub token");
  });

  it("includes author username in issue response", async () => {
    mockRetrieveSecret.mockResolvedValue("ghp_token");

    // repos query returns one repo
    const repoChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          id: "repo-1",
          repoUrl: "https://github.com/org/repo",
          fullName: "org/repo",
          workspaceId: "ws-1",
        },
      ]),
    };
    // tasks query returns empty
    const taskChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect.mockReturnValueOnce(repoChain).mockReturnValueOnce(taskChain);

    // Mock GitHub API response
    const mockIssue = {
      id: 1,
      number: 42,
      title: "Test issue",
      body: "Test body",
      state: "open",
      html_url: "https://github.com/org/repo/issues/42",
      labels: [],
      user: { login: "testauthor" },
      assignee: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockIssue]),
      }),
    );

    const res = await app.inject({ method: "GET", url: "/api/issues" });

    expect(res.statusCode).toBe(200);
    const { issues } = res.json();
    expect(issues).toHaveLength(1);
    expect(issues[0].author).toBe("testauthor");
    expect(issues[0].number).toBe(42);
  });

  it("returns null author when issue has no user", async () => {
    mockRetrieveSecret.mockResolvedValue("ghp_token");

    const repoChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          id: "repo-1",
          repoUrl: "https://github.com/org/repo",
          fullName: "org/repo",
          workspaceId: "ws-1",
        },
      ]),
    };
    const taskChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect.mockReturnValueOnce(repoChain).mockReturnValueOnce(taskChain);

    const mockIssue = {
      id: 2,
      number: 43,
      title: "No author issue",
      body: "",
      state: "open",
      html_url: "https://github.com/org/repo/issues/43",
      labels: [],
      user: null,
      assignee: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockIssue]),
      }),
    );

    const res = await app.inject({ method: "GET", url: "/api/issues" });

    expect(res.statusCode).toBe(200);
    const { issues } = res.json();
    expect(issues).toHaveLength(1);
    expect(issues[0].author).toBeNull();
  });

  it("returns empty issues when no repos are configured", async () => {
    mockRetrieveSecret.mockResolvedValue("ghp_token");

    // repos query returns empty
    const repoChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    // tasks query
    const taskChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect
      .mockReturnValueOnce(repoChain) // repos query (with workspace filter)
      .mockReturnValueOnce(taskChain); // tasks query

    const res = await app.inject({ method: "GET", url: "/api/issues" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([]);
  });
});

describe("POST /api/issues/assign", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 404 when repo not found", async () => {
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect.mockReturnValue(chainable);

    const res = await app.inject({
      method: "POST",
      url: "/api/issues/assign",
      payload: {
        issueNumber: 42,
        repoId: "nonexistent",
        title: "Fix bug",
        body: "Bug description",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 503 when no GitHub token is configured", async () => {
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          id: "repo-1",
          repoUrl: "https://github.com/org/repo",
          workspaceId: "ws-1",
        },
      ]),
    };
    mockDbSelect.mockReturnValue(chainable);
    mockRetrieveSecret.mockRejectedValue(new Error("not found"));

    const res = await app.inject({
      method: "POST",
      url: "/api/issues/assign",
      payload: {
        issueNumber: 42,
        repoId: "repo-1",
        title: "Fix bug",
        body: "Bug description",
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("No GitHub token");
  });

  it("returns 404 for repo in different workspace", async () => {
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          id: "repo-1",
          repoUrl: "https://github.com/org/repo",
          workspaceId: "ws-other",
        },
      ]),
    };
    mockDbSelect.mockReturnValue(chainable);

    const res = await app.inject({
      method: "POST",
      url: "/api/issues/assign",
      payload: {
        issueNumber: 42,
        repoId: "repo-1",
        title: "Fix bug",
        body: "Bug description",
      },
    });

    expect(res.statusCode).toBe(404);
  });
});
