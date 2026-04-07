import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../plugins/auth.js";
import * as prReviewService from "../services/pr-review-service.js";
import { logger } from "../logger.js";

const listPrsQuerySchema = z.object({
  repoId: z.string().optional(),
});

const createReviewSchema = z.object({
  prUrl: z.string().min(1),
});

const updateDraftSchema = z.object({
  summary: z.string().optional(),
  verdict: z.string().optional(),
  fileComments: z
    .array(
      z.object({
        path: z.string(),
        line: z.number().optional(),
        side: z.string().optional(),
        body: z.string(),
      }),
    )
    .optional(),
});

const mergePrSchema = z.object({
  prUrl: z.string().min(1),
  mergeMethod: z.enum(["merge", "squash", "rebase"]),
});

const prStatusQuerySchema = z.object({
  prUrl: z.string().min(1),
});

const idParamsSchema = z.object({ id: z.string() });

export async function prReviewRoutes(app: FastifyInstance) {
  // List open PRs from configured repos
  app.get("/api/pull-requests", async (req, reply) => {
    const query = listPrsQuerySchema.parse(req.query);
    const pullRequests = await prReviewService.listOpenPrs(
      req.user?.workspaceId ?? undefined,
      query.repoId,
    );
    reply.send({ pullRequests });
  });

  // Create a pr_review task for a PR
  app.post(
    "/api/pull-requests/review",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const parsed = createReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0].message });
      }

      try {
        const result = await prReviewService.launchPrReview({
          prUrl: parsed.data.prUrl,
          workspaceId: req.user?.workspaceId ?? undefined,
          createdBy: req.user?.id,
        });
        reply.status(201).send(result);
      } catch (err: any) {
        logger.warn({ err, prUrl: parsed.data.prUrl }, "Failed to launch PR review");
        reply.status(400).send({ error: err.message });
      }
    },
  );

  // Get review draft for a task
  app.get("/api/tasks/:id/review-draft", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const draft = await prReviewService.getReviewDraft(id);
    if (!draft) return reply.status(404).send({ error: "No review draft found" });
    reply.send({ draft });
  });

  // Update review draft (edit summary, verdict, comments)
  app.patch(
    "/api/tasks/:id/review-draft",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const { id } = idParamsSchema.parse(req.params);
      const bodyParsed = updateDraftSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: bodyParsed.error.issues[0].message });
      }

      // Get the draft for this task
      const draft = await prReviewService.getReviewDraft(id);
      if (!draft) return reply.status(404).send({ error: "No review draft found" });

      try {
        const updated = await prReviewService.updateReviewDraft(draft.id, bodyParsed.data);
        reply.send({ draft: updated });
      } catch (err: any) {
        reply.status(400).send({ error: err.message });
      }
    },
  );

  // Submit review to git platform (GitHub or GitLab)
  app.post(
    "/api/tasks/:id/review-draft/submit",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const { id } = idParamsSchema.parse(req.params);
      const draft = await prReviewService.getReviewDraft(id);
      if (!draft) return reply.status(404).send({ error: "No review draft found" });

      try {
        const result = await prReviewService.submitReview(draft.id, req.user?.id);
        reply.send(result);
      } catch (err: any) {
        logger.warn({ err, taskId: id }, "Failed to submit review");
        reply.status(400).send({ error: err.message });
      }
    },
  );

  // Re-review: create a new review task for the same PR
  app.post(
    "/api/tasks/:id/review-draft/re-review",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const { id } = idParamsSchema.parse(req.params);

      try {
        const result = await prReviewService.reReview(
          id,
          req.user?.id,
          req.user?.workspaceId ?? undefined,
        );
        reply.status(201).send(result);
      } catch (err: any) {
        logger.warn({ err, taskId: id }, "Failed to re-review PR");
        reply.status(400).send({ error: err.message });
      }
    },
  );

  // Merge a PR
  app.post(
    "/api/pull-requests/merge",
    { preHandler: [requireRole("member")] },
    async (req, reply) => {
      const mergeParsed = mergePrSchema.safeParse(req.body);
      if (!mergeParsed.success) {
        return reply.status(400).send({ error: mergeParsed.error.issues[0].message });
      }

      try {
        const result = await prReviewService.mergePr({
          prUrl: mergeParsed.data.prUrl,
          mergeMethod: mergeParsed.data.mergeMethod,
          userId: req.user?.id,
        });
        reply.send(result);
      } catch (err: any) {
        logger.warn({ err, prUrl: mergeParsed.data.prUrl }, "Failed to merge PR");
        reply.status(400).send({ error: err.message });
      }
    },
  );

  // Get CI + review status for a PR
  app.get("/api/pull-requests/status", async (req, reply) => {
    const statusQuery = prStatusQuerySchema.safeParse(req.query);
    if (!statusQuery.success) {
      return reply.status(400).send({ error: "prUrl query param is required" });
    }

    try {
      const status = await prReviewService.getPrStatus(statusQuery.data.prUrl);
      reply.send(status);
    } catch (err: any) {
      logger.warn({ err, prUrl: statusQuery.data.prUrl }, "Failed to get PR status");
      reply.status(400).send({ error: err.message });
    }
  });
}
