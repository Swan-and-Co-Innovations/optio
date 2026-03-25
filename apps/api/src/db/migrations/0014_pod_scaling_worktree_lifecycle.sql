-- Pod scaling: add maxPodInstances and maxAgentsPerPod to repos
ALTER TABLE "repos" ADD COLUMN "max_pod_instances" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "max_agents_per_pod" integer DEFAULT 2 NOT NULL;--> statement-breakpoint

-- Multi-pod: drop unique constraint on repo_pods.repo_url, add instance_index
ALTER TABLE "repo_pods" DROP CONSTRAINT IF EXISTS "repo_pods_repo_url_unique";--> statement-breakpoint
ALTER TABLE "repo_pods" ADD COLUMN "instance_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Worktree lifecycle: add worktree_state and last_pod_id to tasks
ALTER TABLE "tasks" ADD COLUMN "worktree_state" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_pod_id" uuid;
