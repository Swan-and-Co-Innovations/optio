import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  ticketProviders: {
    enabled: "ticket_providers.enabled",
  },
  repos: {
    repoUrl: "repos.repoUrl",
  },
}));

vi.mock("@optio/ticket-providers", () => ({
  getTicketProvider: vi.fn(),
}));

vi.mock("./task-service.js", () => ({
  createTask: vi.fn(),
  transitionTask: vi.fn(),
  listTasks: vi.fn(),
}));

vi.mock("../workers/task-worker.js", () => ({
  taskQueue: {
    add: vi.fn(),
  },
}));

vi.mock("./repo-service.js", () => ({
  getRepoByUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock("./secret-service.js", () => ({
  retrieveSecret: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from "../db/client.js";
import { ticketProviders, repos } from "../db/schema.js";
import { getTicketProvider } from "@optio/ticket-providers";
import * as taskService from "./task-service.js";
import { taskQueue } from "../workers/task-worker.js";
import { retrieveSecret } from "./secret-service.js";
import { syncAllTickets } from "./ticket-sync-service.js";

/**
 * Mock db.select() to handle two query patterns, matching on the .from() argument:
 * - db.select().from(ticketProviders).where(...) — returns providers
 * - db.select({...}).from(repos) — returns configured repos (no .where())
 */
function mockDbSelect(providers: any[], configuredRepos: any[] = []) {
  (db.select as any) = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: any) => {
      if (table === ticketProviders) {
        return {
          where: vi.fn().mockResolvedValue(providers),
        };
      }
      if (table === repos) {
        return Promise.resolve(configuredRepos);
      }
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  }));
}

describe("ticket-sync-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no secrets stored
    vi.mocked(retrieveSecret).mockRejectedValue(new Error("Secret not found"));
  });

  it("syncs new tickets and creates tasks", async () => {
    mockDbSelect([
      { id: "p1", source: "github", config: { repoUrl: "https://github.com/o/r" }, enabled: true },
    ]);

    const mockProvider = {
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "Fix bug",
          body: "Description",
          source: "github",
          externalId: "123",
          url: "https://github.com/o/r/issues/123",
          labels: [],
          repo: null,
        },
      ]),
      fetchTicketComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getTicketProvider).mockReturnValue(mockProvider as any);

    // No existing tasks
    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);

    vi.mocked(taskService.createTask).mockResolvedValue({
      id: "task-1",
      maxRetries: 3,
    } as any);

    const count = await syncAllTickets();

    expect(count).toBe(1);
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fix bug",
        repoUrl: "https://github.com/o/r",
        agentType: "claude-code",
        ticketSource: "github",
        ticketExternalId: "123",
      }),
    );
    expect(taskService.transitionTask).toHaveBeenCalledWith("task-1", "queued", "ticket_sync");
    expect(taskQueue.add).toHaveBeenCalled();
    expect(mockProvider.addComment).toHaveBeenCalled();
  });

  it("skips tickets that already have tasks", async () => {
    mockDbSelect([
      { id: "p1", source: "github", config: { repoUrl: "https://github.com/o/r" }, enabled: true },
    ]);

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "Existing",
          body: "",
          source: "github",
          externalId: "123",
          url: "",
          labels: [],
          repo: null,
        },
      ]),
      addComment: vi.fn(),
    } as any);

    // Existing task matches (must include repoUrl for repo-scoped dedup)
    vi.mocked(taskService.listTasks).mockResolvedValue([
      { ticketSource: "github", ticketExternalId: "123", repoUrl: "https://github.com/o/r" },
    ] as any);

    const count = await syncAllTickets();
    expect(count).toBe(0);
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it("uses codex agent type when ticket has codex label", async () => {
    mockDbSelect([
      { id: "p1", source: "github", config: { repoUrl: "https://github.com/o/r" }, enabled: true },
    ]);

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "Codex task",
          body: "",
          source: "github",
          externalId: "456",
          url: "",
          labels: ["codex"],
          repo: null,
        },
      ]),
      fetchTicketComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn(),
    } as any);

    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);
    vi.mocked(taskService.createTask).mockResolvedValue({ id: "t-1", maxRetries: 3 } as any);

    await syncAllTickets();

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: "codex" }),
    );
  });

  it("uses ticket repo URL when available", async () => {
    mockDbSelect(
      [
        {
          id: "p1",
          source: "github",
          config: { repoUrl: "https://github.com/fallback/repo" },
          enabled: true,
        },
      ],
      [{ repoUrl: "https://github.com/owner/specific-repo" }],
    );

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "Task",
          body: "",
          source: "github",
          externalId: "789",
          url: "",
          labels: [],
          repo: "owner/specific-repo",
        },
      ]),
      fetchTicketComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn(),
    } as any);

    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);
    vi.mocked(taskService.createTask).mockResolvedValue({ id: "t-1", maxRetries: 3 } as any);

    await syncAllTickets();

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: "https://github.com/owner/specific-repo",
      }),
    );
  });

  it("skips tickets without repo URL", async () => {
    mockDbSelect([{ id: "p1", source: "github", config: {}, enabled: true }]);

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "No repo",
          body: "",
          source: "github",
          externalId: "999",
          url: "",
          labels: [],
          repo: null,
        },
      ]),
      addComment: vi.fn(),
    } as any);

    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);

    const count = await syncAllTickets();
    expect(count).toBe(0);
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it("handles provider errors gracefully", async () => {
    mockDbSelect([{ id: "p1", source: "github", config: {}, enabled: true }]);

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockRejectedValue(new Error("API error")),
    } as any);

    const count = await syncAllTickets();
    expect(count).toBe(0);
  });

  it("continues syncing when comment fails", async () => {
    mockDbSelect([
      { id: "p1", source: "github", config: { repoUrl: "https://github.com/o/r" }, enabled: true },
    ]);

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "Task",
          body: "",
          source: "github",
          externalId: "111",
          url: "",
          labels: [],
          repo: null,
        },
      ]),
      fetchTicketComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn().mockRejectedValue(new Error("comment failed")),
    } as any);

    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);
    vi.mocked(taskService.createTask).mockResolvedValue({ id: "t-1", maxRetries: 3 } as any);

    const count = await syncAllTickets();
    expect(count).toBe(1); // Task still synced despite comment failure
  });

  it("queries configuredRepos only once even with multiple providers", async () => {
    mockDbSelect(
      [
        {
          id: "p1",
          source: "github",
          config: { repoUrl: "https://github.com/o/r" },
          enabled: true,
        },
        {
          id: "p2",
          source: "jira",
          config: { baseUrl: "https://j.example.com", email: "a@b.com" },
          enabled: true,
        },
      ],
      [{ repoUrl: "https://github.com/o/r" }],
    );

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([]),
    } as any);

    await syncAllTickets();

    // db.select() should be called exactly twice:
    // 1. providers query (from ticketProviders)
    // 2. configuredRepos query (from repos) — only once, not per provider
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("uses provider config baseUrl for GitLab instead of hardcoded default", async () => {
    mockDbSelect(
      [
        {
          id: "p1",
          source: "gitlab",
          config: { baseUrl: "https://gitlab.corp.example.com" },
          enabled: true,
        },
      ],
      [], // no configured repos — forces URL construction fallback
    );

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([
        {
          title: "GL task",
          body: "",
          source: "gitlab",
          externalId: "42",
          url: "",
          labels: [],
          repo: "team/project",
        },
      ]),
      fetchTicketComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn(),
    } as any);

    vi.mocked(taskService.listTasks).mockResolvedValue([] as any);
    vi.mocked(taskService.createTask).mockResolvedValue({ id: "t-1", maxRetries: 3 } as any);

    await syncAllTickets();

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: "https://gitlab.corp.example.com/team/project",
      }),
    );
  });

  it("merges encrypted credentials from secrets store into provider config", async () => {
    mockDbSelect([
      {
        id: "p1",
        source: "jira",
        config: { baseUrl: "https://j.example.com", email: "a@b.com", label: "optio" },
        enabled: true,
      },
    ]);

    // Secret contains the sensitive credentials
    vi.mocked(retrieveSecret).mockResolvedValue(JSON.stringify({ apiToken: "secret-token" }));

    vi.mocked(getTicketProvider).mockReturnValue({
      fetchActionableTickets: vi.fn().mockResolvedValue([]),
    } as any);

    await syncAllTickets();

    // The provider should receive the merged config with credentials
    const provider = vi.mocked(getTicketProvider).mock.results[0].value;
    const configPassedToProvider = provider.fetchActionableTickets.mock.calls[0][0];
    expect(configPassedToProvider.apiToken).toBe("secret-token");
    expect(configPassedToProvider.baseUrl).toBe("https://j.example.com");

    // Secret should be retrieved with the provider ID
    expect(retrieveSecret).toHaveBeenCalledWith("ticket-provider:p1", "ticket-provider");
  });
});
