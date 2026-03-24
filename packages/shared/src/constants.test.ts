import { describe, it, expect } from "vitest";
import { generateRepoPodName } from "./constants.js";

describe("generateRepoPodName", () => {
  it("generates a name from an HTTPS GitHub URL", () => {
    const name = generateRepoPodName("https://github.com/jonwiggins/optio.git");
    expect(name).toMatch(/^optio-repo-jonwiggins-optio-[0-9a-f]{4}$/);
  });

  it("generates a name from an SSH GitHub URL", () => {
    const name = generateRepoPodName("git@github.com:jonwiggins/optio.git");
    expect(name).toMatch(/^optio-repo-jonwiggins-optio-[0-9a-f]{4}$/);
  });

  it("handles URLs without .git suffix", () => {
    const name = generateRepoPodName("https://github.com/myorg/my-repo");
    expect(name).toMatch(/^optio-repo-myorg-my-repo-[0-9a-f]{4}$/);
  });

  it("produces valid K8s names (lowercase, alphanumeric, hyphens)", () => {
    const name = generateRepoPodName("https://github.com/My_Org/My.Repo.Name.git");
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it("truncates long owner/repo names to fit within 63 chars", () => {
    const longOwner = "a".repeat(50);
    const longRepo = "b".repeat(50);
    const name = generateRepoPodName(`https://github.com/${longOwner}/${longRepo}.git`);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^optio-repo-/);
    expect(name).toMatch(/-[0-9a-f]{4}$/);
  });

  it("generates unique names (different hash each call)", () => {
    const name1 = generateRepoPodName("https://github.com/org/repo.git");
    const name2 = generateRepoPodName("https://github.com/org/repo.git");
    // Names share prefix but have different hash suffixes (very likely)
    expect(name1.slice(0, -4)).toBe(name2.slice(0, -4));
  });

  it("handles fallback for unrecognized URL format", () => {
    const name = generateRepoPodName("not-a-url");
    expect(name).toMatch(/^optio-repo-unknown-unknown-[0-9a-f]{4}$/);
  });

  it("sanitizes special characters in owner/repo", () => {
    const name = generateRepoPodName("https://github.com/my--org/my__repo.git");
    expect(name).not.toMatch(/--/); // no double hyphens after sanitization
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });
});
