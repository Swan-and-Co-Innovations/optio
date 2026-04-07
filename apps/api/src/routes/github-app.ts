import type { FastifyInstance } from "fastify";
import { getGitHubToken } from "../services/github-token-service.js";
import { isGitHubAppConfigured } from "../services/github-app-service.js";
import {
  getCredentialSecret,
  resetCredentialSecret,
} from "../services/credential-secret-service.js";
import { verifyInternalRequest } from "../services/hmac-auth-service.js";

export { getCredentialSecret, resetCredentialSecret };

export function buildStatusResponse(): {
  configured: boolean;
  appId?: string;
  installationId?: string;
} {
  if (!isGitHubAppConfigured()) {
    return { configured: false };
  }
  return {
    configured: true,
    appId: process.env.GITHUB_APP_ID,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
  };
}

export default async function githubAppRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Internal endpoint — called by credential helpers in agent pods.
   * Cluster-internal only: the Helm ingress blocks /api/internal/* from public traffic.
   * Pods reach this via the K8s service DNS (optio-api.optio.svc.cluster.local).
   *
   * Authentication: HMAC-SHA256 signature in X-Optio-Signature header.
   * The agent computes HMAC(secret, "{timestamp}.{path}") and sends
   * "t={timestamp},sig={hex}" — the raw secret never crosses the wire.
   * Legacy Bearer token is still accepted for backward compatibility.
   *
   * With taskId: returns the task creator's user token (for task-scoped operations).
   * Without taskId: returns an installation token (for pod-level operations like clone).
   */
  app.get<{ Querystring: { taskId?: string } }>(
    "/api/internal/git-credentials",
    async (req, reply) => {
      const authResult = verifyInternalRequest(
        req.headers as Record<string, string | string[] | undefined>,
        req.url,
      );
      if (authResult) {
        return reply.status(authResult.status).send({ error: authResult.error });
      }

      try {
        const { taskId } = req.query;
        const token = taskId
          ? await getGitHubToken({ taskId })
          : await getGitHubToken({ server: true });
        return reply.send({ token });
      } catch (err) {
        app.log.error(err, "Failed to get git credentials");
        return reply.status(500).send({ error: "Failed to retrieve git credentials" });
      }
    },
  );

  app.get("/api/github-app/status", async (_req, reply) => {
    return reply.send(buildStatusResponse());
  });
}
