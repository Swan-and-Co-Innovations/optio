-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS "tasks_repo_url_state_idx" ON "tasks" ("repo_url", "state");
CREATE INDEX IF NOT EXISTS "tasks_state_idx" ON "tasks" ("state");
CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" ("parent_task_id");
CREATE INDEX IF NOT EXISTS "tasks_created_at_idx" ON "tasks" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "task_logs_task_id_timestamp_idx" ON "task_logs" ("task_id", "timestamp");
CREATE INDEX IF NOT EXISTS "repo_pods_repo_url_idx" ON "repo_pods" ("repo_url");
CREATE INDEX IF NOT EXISTS "task_events_task_id_idx" ON "task_events" ("task_id");
