DO $$ BEGIN
  CREATE TYPE "public"."webhook_event" AS ENUM('task.completed', 'task.failed', 'task.needs_attention', 'task.pr_opened', 'review.completed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "events" jsonb NOT NULL,
  "secret" text,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status_code" integer,
  "response_body" text,
  "success" boolean NOT NULL DEFAULT false,
  "attempt" integer NOT NULL DEFAULT 1,
  "error" text,
  "delivered_at" timestamp with time zone DEFAULT now() NOT NULL
);
