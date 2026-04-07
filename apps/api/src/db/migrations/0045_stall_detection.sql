-- Stall detection: activity heartbeats and per-repo threshold override

-- Activity substate enum
DO $$ BEGIN
  CREATE TYPE "public"."task_activity_substate" AS ENUM('active', 'stalled', 'recovered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tasks: new columns for stall detection
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "activity_substate" "public"."task_activity_substate" NOT NULL DEFAULT 'active';

-- Repos: per-repo stall threshold override
ALTER TABLE "repos"
  ADD COLUMN IF NOT EXISTS "stall_threshold_ms" integer;

-- Partial index for efficient stall detection scan (only running tasks)
CREATE INDEX IF NOT EXISTS "tasks_running_last_activity_idx"
  ON "tasks" ("last_activity_at")
  WHERE "state" = 'running';
