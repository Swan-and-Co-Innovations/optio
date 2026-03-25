-- Add token tracking and model columns for cost optimization insights
ALTER TABLE "tasks" ADD COLUMN "input_tokens" integer;
ALTER TABLE "tasks" ADD COLUMN "output_tokens" integer;
ALTER TABLE "tasks" ADD COLUMN "model_used" text;
