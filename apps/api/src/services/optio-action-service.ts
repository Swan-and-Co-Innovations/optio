import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { optioActions, users } from "../db/schema.js";

/** Fields that should be stripped from params before persisting (security). */
const SENSITIVE_KEYS = new Set([
  "token",
  "secret",
  "password",
  "key",
  "apiKey",
  "api_key",
  "authorization",
  "credential",
  "credentials",
  "oauth_token",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GITHUB_TOKEN",
]);

/** Recursively strip sensitive values from an object. */
function sanitizeParams(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeParams(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface LogActionInput {
  userId?: string;
  action: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  success: boolean;
  conversationSnippet?: string;
  workspaceId?: string;
}

export async function logAction(input: LogActionInput) {
  const [row] = await db
    .insert(optioActions)
    .values({
      userId: input.userId,
      action: input.action,
      params: input.params ? sanitizeParams(input.params) : undefined,
      result: input.result,
      success: input.success,
      conversationSnippet: input.conversationSnippet,
      workspaceId: input.workspaceId,
    })
    .returning();
  return row;
}

export interface ListActionsParams {
  workspaceId?: string;
  userId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export async function listActions(params: ListActionsParams) {
  const conditions = [];

  if (params.workspaceId) {
    conditions.push(eq(optioActions.workspaceId, params.workspaceId));
  }
  if (params.userId) {
    conditions.push(eq(optioActions.userId, params.userId));
  }
  if (params.action) {
    conditions.push(eq(optioActions.action, params.action));
  }
  if (params.startDate) {
    conditions.push(gte(optioActions.createdAt, new Date(params.startDate)));
  }
  if (params.endDate) {
    conditions.push(lte(optioActions.createdAt, new Date(params.endDate)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const rows = await db
    .select({
      id: optioActions.id,
      userId: optioActions.userId,
      action: optioActions.action,
      params: optioActions.params,
      result: optioActions.result,
      success: optioActions.success,
      conversationSnippet: optioActions.conversationSnippet,
      workspaceId: optioActions.workspaceId,
      createdAt: optioActions.createdAt,
      userName: users.displayName,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(optioActions)
    .leftJoin(users, eq(optioActions.userId, users.id))
    .where(where)
    .orderBy(desc(optioActions.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count for pagination
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(optioActions)
    .where(where);

  return {
    actions: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      action: row.action,
      params: row.params,
      result: row.result,
      success: row.success,
      conversationSnippet: row.conversationSnippet,
      workspaceId: row.workspaceId,
      createdAt: row.createdAt,
      user: row.userId
        ? {
            id: row.userId,
            displayName: row.userName!,
            email: row.userEmail!,
            avatarUrl: row.userAvatar,
          }
        : undefined,
    })),
    total: countResult.count,
    limit,
    offset,
  };
}

/** Get optio actions that reference a specific task (by taskId in params or result). */
export async function getActionsForTask(taskId: string) {
  const rows = await db
    .select({
      id: optioActions.id,
      userId: optioActions.userId,
      action: optioActions.action,
      params: optioActions.params,
      result: optioActions.result,
      success: optioActions.success,
      conversationSnippet: optioActions.conversationSnippet,
      createdAt: optioActions.createdAt,
      userName: users.displayName,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
    })
    .from(optioActions)
    .leftJoin(users, eq(optioActions.userId, users.id))
    .where(
      sql`${optioActions.params}->>'taskId' = ${taskId}
        OR ${optioActions.result}->>'taskId' = ${taskId}
        OR ${optioActions.params}->>'taskIds' @> ${JSON.stringify([taskId])}::jsonb
        OR ${optioActions.result}->>'affectedIds' @> ${JSON.stringify([taskId])}::jsonb`,
    )
    .orderBy(optioActions.createdAt);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    action: row.action,
    params: row.params,
    result: row.result,
    success: row.success,
    conversationSnippet: row.conversationSnippet,
    createdAt: row.createdAt,
    user: row.userId
      ? {
          id: row.userId,
          displayName: row.userName!,
          email: row.userEmail!,
          avatarUrl: row.userAvatar,
        }
      : undefined,
  }));
}

/** Get distinct action names for filtering UI. */
export async function listActionTypes(workspaceId?: string) {
  const where = workspaceId ? eq(optioActions.workspaceId, workspaceId) : undefined;
  const rows = await db
    .selectDistinct({ action: optioActions.action })
    .from(optioActions)
    .where(where)
    .orderBy(optioActions.action);
  return rows.map((r) => r.action);
}
