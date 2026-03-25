"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Loader2, Play, ArrowLeft, GitMerge } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [execRepoUrl, setExecRepoUrl] = useState("");

  const loadWorkflow = useCallback(() => {
    api
      .getWorkflow(id)
      .then((res) => {
        setWorkflow(res.workflow);
        if (res.workflow.repoUrl) setExecRepoUrl(res.workflow.repoUrl);
      })
      .catch(() => toast.error("Failed to load workflow"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  const handleExecute = async () => {
    if (!execRepoUrl.trim()) {
      toast.error("Repository URL is required to execute");
      return;
    }
    setExecuting(true);
    try {
      const result = await api.executeWorkflow({ workflowId: id, repoUrl: execRepoUrl });
      toast.success(`Workflow started: ${result.tasks.length} tasks created`);
      router.push("/tasks");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to execute workflow");
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="p-6 text-center text-text-muted">
        Workflow not found.{" "}
        <Link href="/workflows" className="text-primary hover:underline">
          Back to workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link
        href="/workflows"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All Workflows
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-primary" />
            {workflow.name}
          </h1>
          {workflow.description && (
            <p className="text-sm text-text-muted mt-1">{workflow.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-text-muted/60">
            <span>{workflow.steps?.length ?? 0} steps</span>
            <span>Created {formatRelativeTime(workflow.createdAt)}</span>
            {workflow.repoUrl && <span className="truncate max-w-xs">{workflow.repoUrl}</span>}
          </div>
        </div>
      </div>

      {/* Execute section */}
      <div className="p-4 rounded-lg border border-border bg-bg-card mb-6">
        <h2 className="text-sm font-medium mb-3">Execute Workflow</h2>
        <div className="flex gap-3">
          <input
            value={execRepoUrl}
            onChange={(e) => setExecRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          <button
            onClick={handleExecute}
            disabled={executing}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {executing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Execute
          </button>
        </div>
      </div>

      {/* Steps */}
      <h2 className="text-sm font-medium mb-3">Steps</h2>
      <div className="space-y-3">
        {(workflow.steps ?? []).map((step: any, i: number) => {
          const deps = (step.dependsOnSteps ?? []) as number[];
          return (
            <div key={step.id ?? i} className="p-4 rounded-lg border border-border bg-bg-card">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {step.stepOrder}
                </span>
                <span className="font-medium text-sm">{step.title}</span>
                <span className="text-xs text-text-muted/60 ml-auto">{step.agentType}</span>
              </div>
              <p className="text-xs text-text-muted mt-1 line-clamp-2">{step.prompt}</p>
              {deps.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-xs text-text-muted/60">Depends on:</span>
                  {deps.map((d: number) => (
                    <span
                      key={d}
                      className="px-1.5 py-0.5 rounded text-xs border border-border text-text-muted"
                    >
                      Step {d}
                    </span>
                  ))}
                </div>
              )}
              {step.conditions && Object.keys(step.conditions).length > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-xs text-text-muted/60">Conditions:</span>
                  {step.conditions.ifPrOpened && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400">
                      PR opened
                    </span>
                  )}
                  {step.conditions.ifCiPasses && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/10 text-green-400">
                      CI passes
                    </span>
                  )}
                  {step.conditions.requiresApproval && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-amber-500/10 text-amber-400">
                      Requires approval
                    </span>
                  )}
                  {step.conditions.ifCostBelow != null && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-violet-500/10 text-violet-400">
                      Cost &lt; ${step.conditions.ifCostBelow}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
