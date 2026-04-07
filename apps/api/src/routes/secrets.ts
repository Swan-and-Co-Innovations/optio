import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as secretService from "../services/secret-service.js";
import { requireRole } from "../plugins/auth.js";

const scopeQuerySchema = z.object({ scope: z.string().optional() });
const nameParamsSchema = z.object({ name: z.string() });

const createSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  scope: z.string().optional(),
});

export async function secretRoutes(app: FastifyInstance) {
  // List secrets (names only) — any workspace member can view
  app.get("/api/secrets", async (req, reply) => {
    const query = scopeQuerySchema.parse(req.query);
    const workspaceId = req.user?.workspaceId ?? null;
    const secrets = await secretService.listSecrets(query.scope, workspaceId);
    reply.send({ secrets });
  });

  // Create/update secret — admin only
  app.post("/api/secrets", { preHandler: [requireRole("admin")] }, async (req, reply) => {
    const input = createSecretSchema.parse(req.body);
    const workspaceId = req.user?.workspaceId ?? null;
    await secretService.storeSecret(input.name, input.value, input.scope, workspaceId);
    reply.status(201).send({ name: input.name, scope: input.scope ?? "global" });
  });

  // Delete secret — admin only
  app.delete("/api/secrets/:name", { preHandler: [requireRole("admin")] }, async (req, reply) => {
    const { name } = nameParamsSchema.parse(req.params);
    const query = scopeQuerySchema.parse(req.query);
    const workspaceId = req.user?.workspaceId ?? null;
    await secretService.deleteSecret(name, query.scope, workspaceId);
    reply.status(204).send();
  });
}
