-- Add OpenCode adapter columns to repos table (experimental)
ALTER TABLE "repos" ADD COLUMN "opencode_model" text;
ALTER TABLE "repos" ADD COLUMN "opencode_agent" text;
ALTER TABLE "repos" ADD COLUMN "opencode_provider" text;
