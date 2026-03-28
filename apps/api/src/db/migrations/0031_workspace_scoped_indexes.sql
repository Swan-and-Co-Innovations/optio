-- Add missing indexes for workspace-scoped queries
CREATE INDEX IF NOT EXISTS "tasks_workspace_state_idx" ON "tasks" ("workspace_id", "state");
CREATE INDEX IF NOT EXISTS "tasks_workspace_updated_idx" ON "tasks" ("workspace_id", "updated_at");
CREATE INDEX IF NOT EXISTS "secrets_workspace_id_idx" ON "secrets" ("workspace_id");
CREATE INDEX IF NOT EXISTS "repos_workspace_id_idx" ON "repos" ("workspace_id");
CREATE INDEX IF NOT EXISTS "webhooks_workspace_id_idx" ON "webhooks" ("workspace_id");
CREATE INDEX IF NOT EXISTS "repo_pods_workspace_id_idx" ON "repo_pods" ("workspace_id");
