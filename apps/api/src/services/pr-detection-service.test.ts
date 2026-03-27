import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseOwnerRepo, checkExistingPr } from "./pr-detection-service.js";

// Mock secret-service
vi.mock("./secret-service.js", () => ({
  retrieveSecretWithFallback: vi.fn(),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe("parseOwnerRepo", () => {
  it("parses HTTPS GitHub URL", () => {
    expect(parseOwnerRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses lowercase normalized URL", () => {
    expect(parseOwnerRepo("https://github.com/myorg/myrepo")).toEqual({
      owner: "myorg",
      repo: "myrepo",
    });
  });

  it("returns null for non-GitHub URL", () => {
    expect(parseOwnerRepo("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseOwnerRepo("")).toBeNull();
  });

  it("handles URLs with trailing path segments", () => {
    const result = parseOwnerRepo("https://github.com/owner/repo/tree/main");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

describe("checkExistingPr", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns PR when an open PR exists for the task branch", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockResolvedValue("ghp_test_token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          html_url: "https://github.com/owner/repo/pull/42",
          number: 42,
          state: "open",
        },
      ],
    });

    const result = await checkExistingPr("https://github.com/owner/repo", "task-123", null);

    expect(result).toEqual({
      url: "https://github.com/owner/repo/pull/42",
      number: 42,
      state: "open",
    });

    // Verify the API call used the correct branch
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("head=owner:optio/task-task-123"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_test_token",
        }),
      }),
    );
  });

  it("returns null when no PR exists", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockResolvedValue("ghp_test_token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const result = await checkExistingPr("https://github.com/owner/repo", "task-456", null);

    expect(result).toBeNull();
  });

  it("returns null when GITHUB_TOKEN is unavailable", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockRejectedValue(new Error("No token"));

    const result = await checkExistingPr("https://github.com/owner/repo", "task-789", null);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when GitHub API returns an error", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockResolvedValue("ghp_test_token");

    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await checkExistingPr("https://github.com/owner/repo", "task-err", null);

    expect(result).toBeNull();
  });

  it("returns null for non-GitHub repo URLs", async () => {
    const result = await checkExistingPr("https://gitlab.com/owner/repo", "task-gl", null);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when fetch throws a network error", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockResolvedValue("ghp_test_token");

    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await checkExistingPr("https://github.com/owner/repo", "task-net", null);

    expect(result).toBeNull();
  });

  it("passes workspace ID to secret resolution", async () => {
    const { retrieveSecretWithFallback } = await import("./secret-service.js");
    vi.mocked(retrieveSecretWithFallback).mockResolvedValue("ghp_test_token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await checkExistingPr("https://github.com/owner/repo", "task-ws", "workspace-42");

    expect(retrieveSecretWithFallback).toHaveBeenCalledWith(
      "GITHUB_TOKEN",
      "global",
      "workspace-42",
    );
  });
});
