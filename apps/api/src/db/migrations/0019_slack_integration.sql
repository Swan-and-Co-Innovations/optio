-- Slack integration: per-repo notification settings
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "slack_webhook_url" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "slack_channel" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "slack_notify_on" jsonb;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "slack_enabled" boolean NOT NULL DEFAULT false;
