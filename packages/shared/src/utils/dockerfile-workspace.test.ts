import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Validates that Dockerfiles for services include all workspace members'
 * package.json in their deps stage so pnpm can resolve the full workspace graph.
 *
 * Without the full workspace graph, `pnpm install --frozen-lockfile` may fail
 * because the lockfile was generated with all workspace members present.
 */

const ROOT = resolve(import.meta.dirname, "../../../../");

function getWorkspaceMembers(): string[] {
  const workspaceYaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf-8");
  // Parse simple glob patterns like "apps/*" and "packages/*" from YAML
  const patterns = workspaceYaml
    .split("\n")
    .map((l) => l.replace(/^[\s-]*["']?|["']?\s*$/g, ""))
    .filter((l) => l.includes("/"));

  const members: string[] = [];

  for (const pattern of patterns) {
    const base = pattern.replace("/*", "");
    const baseDir = join(ROOT, base);
    if (!existsSync(baseDir)) continue;

    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(baseDir, entry.name, "package.json"))) {
        members.push(`${base}/${entry.name}`);
      }
    }
  }

  return members;
}

function getDockerfileCopiedPackages(dockerfilePath: string): string[] {
  const content = readFileSync(join(ROOT, dockerfilePath), "utf-8");
  // Match COPY commands that copy package.json for workspace members
  // e.g. "COPY apps/api/package.json apps/api/" or "COPY apps/api/package.json apps/api/tsconfig.json apps/api/"
  const copyPattern = /^COPY\s+(?:--from=\S+\s+)?((?:apps|packages)\/[\w-]+)\/package\.json/gm;
  const packages: string[] = [];
  let match;
  while ((match = copyPattern.exec(content)) !== null) {
    packages.push(match[1]);
  }
  return [...new Set(packages)];
}

describe("Dockerfile workspace completeness", () => {
  const workspaceMembers = getWorkspaceMembers();

  it("pnpm-workspace.yaml has workspace members", () => {
    expect(workspaceMembers.length).toBeGreaterThan(0);
  });

  it("Dockerfile.api deps stage copies package.json for all workspace members", () => {
    const copied = getDockerfileCopiedPackages("Dockerfile.api");
    const missing = workspaceMembers.filter((m) => !copied.includes(m));

    expect(missing).toEqual([]);
  });

  it("Dockerfile.web deps stage copies package.json for all workspace members", () => {
    const copied = getDockerfileCopiedPackages("Dockerfile.web");
    const missing = workspaceMembers.filter((m) => !copied.includes(m));

    expect(missing).toEqual([]);
  });
});
