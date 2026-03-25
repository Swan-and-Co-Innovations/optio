import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { workflows, workflowSteps } from "../db/schema.js";
import {
  type CreateWorkflowInput,
  type ExecuteWorkflowInput,
  normalizeRepoUrl,
  TaskState,
  validateDAG,
} from "@optio/shared";
import * as taskService from "./task-service.js";
import { addDependencies } from "./dependency-service.js";
import { taskQueue } from "../workers/task-worker.js";
import { logger } from "../logger.js";

export async function createWorkflow(input: CreateWorkflowInput) {
  const stepEdges: [string, string][] = [];
  for (const step of input.steps) {
    if (step.dependsOnSteps) {
      for (const depOrder of step.dependsOnSteps) {
        stepEdges.push([String(depOrder), String(step.stepOrder)]);
      }
    }
  }
  if (stepEdges.length > 0) {
    const dagResult = validateDAG(stepEdges);
    if (!dagResult.valid) {
      throw new Error(`Circular step dependency detected: ${dagResult.cycle?.join(" -> ")}`);
    }
  }

  const stepOrders = new Set(input.steps.map((s) => s.stepOrder));
  for (const step of input.steps) {
    for (const depOrder of step.dependsOnSteps ?? []) {
      if (!stepOrders.has(depOrder)) {
        throw new Error(`Step ${step.stepOrder} depends on non-existent step ${depOrder}`);
      }
    }
  }

  const [workflow] = await db
    .insert(workflows)
    .values({
      name: input.name,
      description: input.description,
      repoUrl: input.repoUrl ? normalizeRepoUrl(input.repoUrl) : undefined,
    })
    .returning();

  if (input.steps.length > 0) {
    await db.insert(workflowSteps).values(
      input.steps.map((step) => ({
        workflowId: workflow.id,
        stepOrder: step.stepOrder,
        title: step.title,
        prompt: step.prompt,
        agentType: step.agentType ?? "claude-code",
        dependsOnSteps: step.dependsOnSteps ?? [],
        conditions: step.conditions ?? null,
      })),
    );
  }

  return getWorkflow(workflow.id);
}

export async function getWorkflow(id: string) {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!workflow) return null;

  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, id))
    .orderBy(workflowSteps.stepOrder);

  return { ...workflow, steps };
}

export async function listWorkflows() {
  const allWorkflows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  const results = [];
  for (const wf of allWorkflows) {
    const steps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, wf.id))
      .orderBy(workflowSteps.stepOrder);
    results.push({ ...wf, steps });
  }
  return results;
}

export async function updateWorkflow(
  id: string,
  input: Partial<Pick<CreateWorkflowInput, "name" | "description" | "steps">> & {
    repoUrl?: string | null;
  },
) {
  const existing = await getWorkflow(id);
  if (!existing) throw new Error(`Workflow not found: ${id}`);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.repoUrl !== undefined)
    updates.repoUrl = input.repoUrl ? normalizeRepoUrl(input.repoUrl) : null;

  await db.update(workflows).set(updates).where(eq(workflows.id, id));

  if (input.steps) {
    const stepEdges: [string, string][] = [];
    for (const step of input.steps) {
      if (step.dependsOnSteps) {
        for (const depOrder of step.dependsOnSteps) {
          stepEdges.push([String(depOrder), String(step.stepOrder)]);
        }
      }
    }
    if (stepEdges.length > 0) {
      const dagResult = validateDAG(stepEdges);
      if (!dagResult.valid) {
        throw new Error(`Circular step dependency detected: ${dagResult.cycle?.join(" -> ")}`);
      }
    }

    await db.delete(workflowSteps).where(eq(workflowSteps.workflowId, id));
    if (input.steps.length > 0) {
      await db.insert(workflowSteps).values(
        input.steps.map((step) => ({
          workflowId: id,
          stepOrder: step.stepOrder,
          title: step.title,
          prompt: step.prompt,
          agentType: step.agentType ?? "claude-code",
          dependsOnSteps: step.dependsOnSteps ?? [],
          conditions: step.conditions ?? null,
        })),
      );
    }
  }

  return getWorkflow(id);
}

export async function deleteWorkflow(id: string) {
  await db.delete(workflows).where(eq(workflows.id, id));
}

export async function executeWorkflow(input: ExecuteWorkflowInput) {
  const workflow = await getWorkflow(input.workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${input.workflowId}`);
  if (!workflow.steps || workflow.steps.length === 0) {
    throw new Error("Workflow has no steps");
  }

  const repoUrl = normalizeRepoUrl(input.repoUrl);
  const repoBranch = input.repoBranch ?? "main";

  const stepToTaskId = new Map<number, string>();
  const createdTasks: Array<{ taskId: string; stepOrder: number; title: string }> = [];

  for (const step of workflow.steps) {
    const task = await taskService.createTask({
      title: `[${workflow.name}] ${step.title}`,
      prompt: step.prompt,
      repoUrl,
      repoBranch,
      agentType: step.agentType,
      metadata: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        stepOrder: step.stepOrder,
        conditions: step.conditions,
      },
    });

    stepToTaskId.set(step.stepOrder, task.id);
    createdTasks.push({ taskId: task.id, stepOrder: step.stepOrder, title: step.title });
  }

  for (const step of workflow.steps) {
    if (step.dependsOnSteps && step.dependsOnSteps.length > 0) {
      const taskId = stepToTaskId.get(step.stepOrder)!;
      const depTaskIds = step.dependsOnSteps
        .map((depOrder) => stepToTaskId.get(depOrder))
        .filter((id): id is string => !!id);

      if (depTaskIds.length > 0) {
        await addDependencies(taskId, depTaskIds);
      }
    }
  }

  for (const step of workflow.steps) {
    const hasDeps = step.dependsOnSteps && step.dependsOnSteps.length > 0;
    const taskId = stepToTaskId.get(step.stepOrder)!;

    if (!hasDeps) {
      const task = await taskService.getTask(taskId);
      await taskService.transitionTask(taskId, TaskState.QUEUED, "workflow_start");
      await taskQueue.add(
        "process-task",
        { taskId },
        {
          jobId: taskId,
          priority: task?.priority ?? 100,
          attempts: (task?.maxRetries ?? 3) + 1,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
    }
  }

  logger.info(
    { workflowId: workflow.id, taskCount: createdTasks.length },
    "Workflow execution started",
  );

  return { workflowId: workflow.id, tasks: createdTasks };
}
