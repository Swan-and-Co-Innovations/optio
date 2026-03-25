-- Task dependencies: directed edges in the task DAG
CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "depends_on_task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "task_dep_unique" UNIQUE("task_id", "depends_on_task_id")
);--> statement-breakpoint

-- Workflows: reusable multi-step task templates
CREATE TABLE IF NOT EXISTS "workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "repo_url" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Workflow steps: individual steps within a workflow template
CREATE TABLE IF NOT EXISTS "workflow_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "step_order" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "prompt" text NOT NULL,
  "agent_type" text DEFAULT 'claude-code' NOT NULL,
  "depends_on_steps" jsonb DEFAULT '[]',
  "conditions" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
