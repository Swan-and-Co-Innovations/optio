import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { retrieveSecret, storeSecret } from "../services/secret-service.js";
import { isGitHubAppConfigured } from "../services/github-app-service.js";
import { isAuthDisabled } from "../services/oauth/index.js";

/** Rate limit: 10 requests per minute per IP. */
const RATE_LIMIT = {
  max: 10,
  timeWindow: "1 minute",
};

const requireAdminWhenAuthenticated = async (req: FastifyRequest, reply: FastifyReply) => {
  if (isAuthDisabled()) return;
  if (!req.user) return;
  if (req.user.workspaceRole !== "admin") {
    return reply.status(403).send({ error: "Admin role required" });
  }
};

export async function githubTokenRoutes(app: FastifyInstance) {
  /**
   * GET /api/github-token/status
   *
   * Check the health of the stored GITHUB_TOKEN by validating it against
   * the GitHub API. Returns the token status and authenticated user info.
   */
  app.get(
    "/api/github-token/status",
    { config: { rateLimit: RATE_LIMIT } },
    async (_req, reply) => {
      // Check if a PAT is stored
      let token: string | null = null;
      try {
        token = await retrieveSecret("GITHUB_TOKEN");
      } catch {
        // No token stored
      }

      if (!token) {
        // No PAT — check if GitHub App is configured as an alternative
        if (isGitHubAppConfigured()) {
          return reply.send({
            status: "valid",
            source: "github_app",
            message: "GitHub App integration is configured. No PAT required.",
          });
        }
        return reply.send({
          status: "missing",
          message:
            "No GitHub token configured. PR watching, issue sync, and repo detection will not work.",
        });
      }

      // Validate the stored token against the GitHub API
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Optio" },
        });

        if (res.ok) {
          const user = (await res.json()) as { login: string; name: string };
          return reply.send({
            status: "valid",
            source: "pat",
            user: { login: user.login, name: user.name },
          });
        }

        return reply.send({
          status: "expired",
          source: "pat",
          error: `GitHub returned ${res.status} — token may be expired or revoked`,
          message:
            "Replace your GitHub token to restore PR watching, issue sync, and repo detection.",
        });
      } catch (err) {
        app.log.error(err, "GitHub token validation failed");
        return reply.send({
          status: "error",
          source: "pat",
          error: "Could not reach GitHub API to validate token",
        });
      }
    },
  );

  /**
   * POST /api/github-token/rotate
   *
   * Validate a new GitHub token and replace the stored GITHUB_TOKEN secret.
   * The new token is validated first — if invalid, the existing token is not replaced.
   */
  app.post(
    "/api/github-token/rotate",
    {
      config: { rateLimit: RATE_LIMIT },
      preHandler: [requireAdminWhenAuthenticated],
    },
    async (req, reply) => {
      const { token } = req.body as { token?: string };
      if (!token || !token.trim()) {
        return reply.status(400).send({ success: false, error: "Token is required" });
      }

      // Validate the new token before storing
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token.trim()}`, "User-Agent": "Optio" },
        });

        if (!res.ok) {
          return reply.send({
            success: false,
            error: `GitHub returned ${res.status} — token is invalid or expired`,
          });
        }

        const user = (await res.json()) as { login: string; name: string };

        // Token is valid — store it
        await storeSecret("GITHUB_TOKEN", token.trim(), "global");

        return reply.send({
          success: true,
          user: { login: user.login, name: user.name },
          message: "GitHub token replaced successfully. PR watching and issue sync will resume.",
        });
      } catch (err) {
        app.log.error(err, "GitHub token rotation failed");
        return reply.send({
          success: false,
          error: "Could not validate token — GitHub API may be unreachable",
        });
      }
    },
  );
}
