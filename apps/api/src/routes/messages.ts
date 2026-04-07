import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as taskService from "../services/task-service.js";
import * as messageService from "../services/task-message-service.js";
import { publishTaskMessage } from "../services/task-message-bus.js";
import { publishEvent } from "../services/event-bus.js";
import { getRedisClient } from "../services/event-bus.js";

const idParamsSchema = z.object({ id: z.string() });

const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  mode: z.enum(["soft", "interrupt"]).default("soft"),
});

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export async function messageRoutes(app: FastifyInstance) {
  // Send a message to a running task
  app.post("/api/tasks/:id/message", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const { content, mode } = sendMessageSchema.parse(req.body);

    // Load task
    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });

    // Workspace scoping
    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }

    // Permission: caller must be task creator or workspace admin
    if (req.user?.id) {
      const allowed = await messageService.canMessageTask(req.user.id, task);
      if (!allowed) {
        return reply.status(403).send({ error: "Not authorized to message this task" });
      }
    }

    // State check
    if (task.state !== "running") {
      return reply.status(409).send({
        error: `Task is in '${task.state}' state. Messages can only be sent to running tasks.`,
      });
    }

    // Agent type check
    if (task.agentType !== "claude-code") {
      return reply.status(501).send({
        error:
          "Mid-task messaging is currently only supported for Claude Code. Other agents will be supported via tmux wrapping in a follow-up.",
      });
    }

    // Rate limiting: 10 messages per minute per user per task
    if (req.user?.id) {
      const redis = getRedisClient();
      const rateLimitKey = `optio:msg-rate:${id}:${req.user.id}`;
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      }
      if (count > RATE_LIMIT_MAX) {
        return reply.status(429).send({
          error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} messages per minute per task.`,
        });
      }
    }

    // Insert message
    const message = await messageService.sendMessage({
      taskId: id,
      content,
      mode,
      userId: req.user?.id,
      workspaceId: task.workspaceId ?? undefined,
    });

    // Record audit event
    const trigger = mode === "interrupt" ? "user_interrupt" : "user_message";
    await taskService.recordTaskEvent(id, task.state, trigger, content.slice(0, 200), req.user?.id);

    // Publish to WebSocket (task:message event)
    const userDisplayName = req.user?.displayName ?? null;
    await publishEvent({
      type: "task:message",
      taskId: id,
      messageId: message.id,
      userId: req.user?.id ?? null,
      userDisplayName,
      content,
      mode,
      createdAt: message.createdAt.toISOString(),
    });

    // Publish to per-task Redis channel for the worker to pick up
    await publishTaskMessage(id, {
      messageId: message.id,
      content,
      mode,
      userDisplayName,
    });

    app.log.info(
      {
        taskId: id,
        messageId: message.id,
        userId: req.user?.id,
        contentPreview: content.slice(0, 200),
      },
      "Task message sent",
    );

    reply.status(202).send({
      message: {
        id: message.id,
        taskId: message.taskId,
        userId: message.userId,
        content: message.content,
        mode: message.mode,
        createdAt: message.createdAt.toISOString(),
        deliveredAt: null,
        ackedAt: null,
      },
    });
  });

  // List messages for a task
  app.get("/api/tasks/:id/messages", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);

    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }

    const messages = await messageService.listMessages(id);
    reply.send({
      messages: messages.map((m) => ({
        id: m.id,
        taskId: m.taskId,
        userId: m.userId,
        content: m.content,
        mode: m.mode,
        createdAt: m.createdAt,
        deliveredAt: m.deliveredAt,
        ackedAt: m.ackedAt,
        deliveryError: m.deliveryError,
        user: m.user,
      })),
    });
  });
}
