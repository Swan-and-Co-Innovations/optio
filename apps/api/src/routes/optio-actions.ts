import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as optioActionService from "../services/optio-action-service.js";
import { requireRole } from "../plugins/auth.js";

const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export async function optioActionRoutes(app: FastifyInstance) {
  // List recent Optio actions — paginated, filterable by user/action/date
  app.get("/api/optio/actions", { preHandler: [requireRole("member")] }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    const result = await optioActionService.listActions({
      workspaceId: req.user?.workspaceId ?? undefined,
      userId: parsed.data.userId,
      action: parsed.data.action,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    reply.send(result);
  });

  // List distinct action types for filter dropdown
  app.get(
    "/api/optio/actions/types",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const types = await optioActionService.listActionTypes(req.user?.workspaceId ?? undefined);
      reply.send({ types });
    },
  );
}
