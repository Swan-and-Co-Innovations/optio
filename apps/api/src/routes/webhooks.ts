import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isSsrfSafeUrl } from "../utils/ssrf.js";
import * as webhookService from "../services/webhook-service.js";

const createWebhookSchema = z.object({
  url: z.string().url().refine(isSsrfSafeUrl, {
    message: "URL must not target private or internal addresses",
  }),
  events: z
    .array(
      z.enum([
        "task.completed",
        "task.failed",
        "task.needs_attention",
        "task.pr_opened",
        "review.completed",
      ]),
    )
    .min(1),
  secret: z.string().min(1).optional(),
  description: z.string().optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  // List all webhooks
  app.get("/api/webhooks", async (_req, reply) => {
    const hooks = await webhookService.listWebhooks();
    // Mask secrets in the response
    const masked = hooks.map((h) => ({
      ...h,
      secret: h.secret ? "••••••" : null,
    }));
    reply.send({ webhooks: masked });
  });

  // Get a single webhook
  app.get("/api/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const webhook = await webhookService.getWebhook(id);
    if (!webhook) return reply.status(404).send({ error: "Webhook not found" });
    reply.send({
      webhook: { ...webhook, secret: webhook.secret ? "••••••" : null },
    });
  });

  // Create a webhook
  app.post("/api/webhooks", async (req, reply) => {
    const body = createWebhookSchema.parse(req.body);
    const webhook = await webhookService.createWebhook(body, (req as any).user?.id);
    reply.status(201).send({ webhook: { ...webhook, secret: webhook.secret ? "••••••" : null } });
  });

  // Delete a webhook
  app.delete("/api/webhooks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await webhookService.deleteWebhook(id);
    if (!deleted) return reply.status(404).send({ error: "Webhook not found" });
    reply.status(204).send();
  });

  // List deliveries for a webhook (delivery log)
  app.get("/api/webhooks/:id/deliveries", async (req, reply) => {
    const { id } = req.params as { id: string };
    const webhook = await webhookService.getWebhook(id);
    if (!webhook) return reply.status(404).send({ error: "Webhook not found" });
    const { limit } = (req.query as { limit?: string }) ?? {};
    const deliveries = await webhookService.getWebhookDeliveries(id, {
      limit: limit ? parseInt(limit, 10) : 50,
    });
    reply.send({ deliveries });
  });
}
