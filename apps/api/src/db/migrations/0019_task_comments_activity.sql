-- Add task_comments table
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "task_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");

-- Add user_id column to task_events for audit trail
ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
