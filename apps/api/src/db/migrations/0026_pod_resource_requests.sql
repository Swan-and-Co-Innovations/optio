-- Add per-repo pod resource requests and limits (CPU and memory)
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cpu_request" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cpu_limit" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "memory_request" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "memory_limit" text;
