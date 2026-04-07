-- Mid-task messaging: user → agent communication during running tasks.
-- New enum for message delivery mode.
DO $$ BEGIN
  CREATE TYPE "task_message_mode" AS ENUM ('soft', 'interrupt');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New table for task messages (distinct from task_comments).
CREATE TABLE IF NOT EXISTS "task_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id"),
  "content" text NOT NULL,
  "mode" "task_message_mode" NOT NULL DEFAULT 'soft',
  "workspace_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "acked_at" timestamp with time zone,
  "delivery_error" text
);

CREATE INDEX IF NOT EXISTS "task_messages_task_id_idx" ON "task_messages" ("task_id");
CREATE INDEX IF NOT EXISTS "task_messages_task_created_idx" ON "task_messages" ("task_id", "created_at");

-- Add last_message_at column to tasks table.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp with time zone;
