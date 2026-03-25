import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  handleSlackAction,
  sendSlackNotification,
  buildSlackMessage,
} from "../services/slack-service.js";
import { logger } from "../logger.js";

export async function slackRoutes(app: FastifyInstance) {
  /**
   * Slack interactive components endpoint.
   * Slack sends a POST with a `payload` form field containing JSON
   * when a user clicks a button in a message.
   */
  app.post("/api/webhooks/slack/actions", async (req, reply) => {
    try {
      // Slack sends interactive payloads as application/x-www-form-urlencoded
      // with a single `payload` field containing JSON
      const body = req.body as { payload?: string } | string;
      let payload: any;

      if (typeof body === "string") {
        payload = JSON.parse(body);
      } else if (body?.payload) {
        payload = JSON.parse(body.payload);
      } else {
        payload = body;
      }

      if (!payload?.actions || !Array.isArray(payload.actions)) {
        return reply.status(400).send({ error: "No actions in payload" });
      }

      const action = payload.actions[0];
      if (!action?.action_id || !action?.value) {
        return reply.status(400).send({ error: "Invalid action format" });
      }

      const result = await handleSlackAction(action.action_id, action.value);

      // Respond with a message update for the Slack interaction
      reply.send({
        response_type: "ephemeral",
        replace_original: false,
        text: result.text,
      });
    } catch (err) {
      logger.error({ err }, "Failed to handle Slack action");
      reply.status(200).send({
        response_type: "ephemeral",
        text: ":x: An error occurred processing your action.",
      });
    }
  });

  /**
   * Test endpoint to send a sample Slack notification.
   * Useful for verifying webhook configuration.
   */
  app.post("/api/slack/test", async (req, reply) => {
    const schema = z.object({
      webhookUrl: z.string().url(),
      channel: z.string().optional(),
    });
    const { webhookUrl, channel } = schema.parse(req.body);

    const sampleTask = {
      id: "00000000-0000-0000-0000-000000000000",
      title: "Test notification from Optio",
      repoUrl: "https://github.com/example/test-repo",
      state: "completed" as any,
      prUrl: "https://github.com/example/test-repo/pull/1",
      costUsd: "0.42",
    };

    try {
      await sendSlackNotification(webhookUrl, sampleTask, "completed", channel);
      reply.send({ ok: true, message: "Test notification sent" });
    } catch (err) {
      reply.status(400).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * Get current Slack configuration status.
   */
  app.get("/api/slack/status", async (_req, reply) => {
    const { getGlobalSlackWebhookUrl } = await import("../services/slack-service.js");
    const globalConfigured = !!(await getGlobalSlackWebhookUrl());
    reply.send({ globalWebhookConfigured: globalConfigured });
  });
}
