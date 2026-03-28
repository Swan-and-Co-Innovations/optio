-- Optio actions audit trail table
CREATE TABLE IF NOT EXISTS "optio_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "action" text NOT NULL,
  "params" jsonb,
  "result" jsonb,
  "success" boolean NOT NULL,
  "conversation_snippet" text,
  "workspace_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "optio_actions_user_id_idx" ON "optio_actions" ("user_id");
CREATE INDEX IF NOT EXISTS "optio_actions_action_idx" ON "optio_actions" ("action");
CREATE INDEX IF NOT EXISTS "optio_actions_created_at_idx" ON "optio_actions" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "optio_actions_workspace_id_idx" ON "optio_actions" ("workspace_id");
