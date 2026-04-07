import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as dependencyService from "../services/dependency-service.js";
import * as taskService from "../services/task-service.js";

const idParamsSchema = z.object({ id: z.string() });
const depParamsSchema = z.object({ id: z.string(), depTaskId: z.string() });

export async function dependencyRoutes(app: FastifyInstance) {
  // List dependencies for a task (tasks it depends on)
  app.get("/api/tasks/:id/dependencies", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }
    const dependencies = await dependencyService.getDependencies(id);
    reply.send({ dependencies });
  });

  // List dependents for a task (tasks that depend on it)
  app.get("/api/tasks/:id/dependents", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }
    const dependents = await dependencyService.getDependents(id);
    reply.send({ dependents });
  });

  // Add dependencies to a task
  app.post("/api/tasks/:id/dependencies", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = z.object({ dependsOnIds: z.array(z.string().uuid()).min(1) }).parse(req.body);

    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }

    try {
      await dependencyService.addDependencies(id, body.dependsOnIds);
      reply.status(201).send({ ok: true });
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Remove a dependency
  app.delete("/api/tasks/:id/dependencies/:depTaskId", async (req, reply) => {
    const { id, depTaskId } = depParamsSchema.parse(req.params);
    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && task.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Task not found" });
    }
    const removed = await dependencyService.removeDependency(id, depTaskId);
    if (!removed) return reply.status(404).send({ error: "Dependency not found" });
    reply.status(204).send();
  });
}
