import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as workflowService from "../services/workflow-service.js";

const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  repoUrl: z.string().optional(),
  agentType: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  condition: z
    .object({
      type: z.enum(["always", "if_pr_opened", "if_ci_passes", "if_cost_under"]),
      value: z.string().optional(),
    })
    .optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(stepSchema).min(1),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(stepSchema).min(1).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

const runWorkflowBodySchema = z
  .object({
    repoUrl: z.string().optional(),
  })
  .optional()
  .default({});

const idParamsSchema = z.object({ id: z.string() });

export async function workflowRoutes(app: FastifyInstance) {
  // List workflow templates
  app.get("/api/workflow-templates", async (req, reply) => {
    const templates = await workflowService.listWorkflowTemplates(
      req.user?.workspaceId ?? undefined,
    );
    reply.send({ templates });
  });

  // Get a workflow template
  app.get("/api/workflow-templates/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const template = await workflowService.getWorkflowTemplate(id);
    if (!template) return reply.status(404).send({ error: "Workflow template not found" });
    reply.send({ template });
  });

  // Create a workflow template
  app.post("/api/workflow-templates", async (req, reply) => {
    const input = createTemplateSchema.parse(req.body);
    try {
      const template = await workflowService.createWorkflowTemplate({
        ...input,
        workspaceId: req.user?.workspaceId ?? undefined,
        createdBy: req.user?.id,
      });
      reply.status(201).send({ template });
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update a workflow template
  app.patch("/api/workflow-templates/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateTemplateSchema.parse(req.body);
    try {
      const template = await workflowService.updateWorkflowTemplate(id, input);
      if (!template) return reply.status(404).send({ error: "Workflow template not found" });
      reply.send({ template });
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete a workflow template
  app.delete("/api/workflow-templates/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await workflowService.deleteWorkflowTemplate(id);
    if (!deleted) return reply.status(404).send({ error: "Workflow template not found" });
    reply.status(204).send();
  });

  // Run a workflow template (instantiate)
  app.post("/api/workflow-templates/:id/run", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = runWorkflowBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }
    const body = parsed.data;
    try {
      const run = await workflowService.runWorkflow(id, {
        workspaceId: req.user?.workspaceId ?? undefined,
        createdBy: req.user?.id,
        repoUrlOverride: body.repoUrl,
      });
      reply.status(201).send({ run });
    } catch (err) {
      reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // List workflow runs for a template
  app.get("/api/workflow-templates/:id/runs", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const runs = await workflowService.listWorkflowRuns(id);
    reply.send({ runs });
  });

  // Get a workflow run
  app.get("/api/workflow-runs/:id", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const run = await workflowService.getWorkflowRun(id);
    if (!run) return reply.status(404).send({ error: "Workflow run not found" });
    reply.send({ run });
  });
}
