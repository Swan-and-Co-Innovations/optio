-- Add per-repo off-peak-only mode and per-task override
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "off_peak_only" boolean DEFAULT false NOT NULL;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "ignore_off_peak" boolean DEFAULT false NOT NULL;
