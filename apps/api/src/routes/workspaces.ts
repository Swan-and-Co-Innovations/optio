import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as workspaceService from "../services/workspace-service.js";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(500).nullable().optional(),
  allowDockerInDocker: z.boolean().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "member", "viewer"]).optional(),
});

const updateMemberSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

const idParamsSchema = z.object({ id: z.string() });
const memberParamsSchema = z.object({ id: z.string(), userId: z.string() });

export async function workspaceRoutes(app: FastifyInstance) {
  // List current user's workspaces
  app.get("/api/workspaces", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const workspaces = await workspaceService.listUserWorkspaces(req.user.id);
    reply.send({ workspaces });
  });

  // Get a single workspace
  app.get("/api/workspaces/:id", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);
    const workspace = await workspaceService.getWorkspace(id);
    if (!workspace) return reply.status(404).send({ error: "Workspace not found" });

    const role = await workspaceService.getUserRole(id, req.user.id);
    if (!role) return reply.status(403).send({ error: "Not a member of this workspace" });

    reply.send({ workspace, role });
  });

  // Create a workspace
  app.post("/api/workspaces", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const body = createWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.createWorkspace(body, req.user.id);
    reply.status(201).send({ workspace });
  });

  // Update a workspace
  app.patch("/api/workspaces/:id", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);

    const role = await workspaceService.getUserRole(id, req.user.id);
    if (role !== "admin") return reply.status(403).send({ error: "Admin role required" });

    const body = updateWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.updateWorkspace(id, body);
    if (!workspace) return reply.status(404).send({ error: "Workspace not found" });
    reply.send({ workspace });
  });

  // Delete a workspace
  app.delete("/api/workspaces/:id", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);

    const role = await workspaceService.getUserRole(id, req.user.id);
    if (role !== "admin") return reply.status(403).send({ error: "Admin role required" });

    await workspaceService.deleteWorkspace(id);
    reply.status(204).send();
  });

  // Switch active workspace
  app.post("/api/workspaces/:id/switch", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);
    await workspaceService.switchWorkspace(req.user.id, id);
    reply.send({ ok: true });
  });

  // List workspace members
  app.get("/api/workspaces/:id/members", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);

    const role = await workspaceService.getUserRole(id, req.user.id);
    if (!role) return reply.status(403).send({ error: "Not a member of this workspace" });

    const members = await workspaceService.listMembers(id);
    reply.send({ members });
  });

  // Add a member
  app.post("/api/workspaces/:id/members", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id } = idParamsSchema.parse(req.params);

    const callerRole = await workspaceService.getUserRole(id, req.user.id);
    if (callerRole !== "admin") return reply.status(403).send({ error: "Admin role required" });

    const body = addMemberSchema.parse(req.body);
    try {
      await workspaceService.addMember(id, body.userId, body.role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "User not found") {
        return reply.status(404).send({ error: "User not found" });
      }
      throw err;
    }
    reply.status(201).send({ ok: true });
  });

  // Update member role
  app.patch("/api/workspaces/:id/members/:userId", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id, userId } = memberParamsSchema.parse(req.params);

    const callerRole = await workspaceService.getUserRole(id, req.user.id);
    if (callerRole !== "admin") return reply.status(403).send({ error: "Admin role required" });

    const body = updateMemberSchema.parse(req.body);
    await workspaceService.updateMemberRole(id, userId, body.role);
    reply.send({ ok: true });
  });

  // Remove a member
  app.delete("/api/workspaces/:id/members/:userId", async (req, reply) => {
    if (!req.user) return reply.status(401).send({ error: "Authentication required" });
    const { id, userId } = memberParamsSchema.parse(req.params);

    const callerRole = await workspaceService.getUserRole(id, req.user.id);
    if (callerRole !== "admin") return reply.status(403).send({ error: "Admin role required" });

    await workspaceService.removeMember(id, userId);
    reply.status(204).send();
  });
}
