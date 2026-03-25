"use client";

import { use, useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, formatRelativeTime } from "@/lib/utils";
import { StateBadge } from "@/components/state-badge";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Server,
  Circle,
  GitBranch,
  Clock,
  Activity,
  ExternalLink,
  RotateCcw,
} from "lucide-react";

export default function PodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [pod, setPod] = useState<any>(null);
  usePageTitle(pod?.podName ?? "Pod");
  const [loading, setLoading] = useState(true);
  const [healthEvents, setHealthEvents] = useState<any[]>([]);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api
      .getClusterPod(id)
      .then((res) => {
        setPod(res.pod);
        api
          .getHealthEvents(20)
          .then((evRes) => {
            setHealthEvents(evRes.events.filter((e: any) => e.repoPodId === id));
          })
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleRestart = async () => {
    if (!confirm("Restart this pod? Active tasks will be failed.")) return;
    setRestarting(true);
    try {
      await api.restartPod(id);
      toast.success("Pod restart initiated");
      router.push("/cluster");
    } catch {
      toast.error("Failed to restart pod");
    }
    setRestarting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (!pod) {
    return <div className="flex items-center justify-center h-full text-error">Pod not found</div>;
  }

  const runtimeState = pod.runtimeStatus?.state ?? pod.state;
  const repoName =
    pod.repoUrl?.replace(/.*github\.com[/:]/, "").replace(/\.git$/, "") ?? pod.repoUrl;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/cluster" className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Server className="w-5 h-5 text-text-muted" />
        <h1 className="text-2xl font-semibold tracking-tight font-mono">{pod.podName ?? "Pod"}</h1>
        <Circle
          className={cn(
            "w-3 h-3 fill-current",
            runtimeState === "running"
              ? "text-success"
              : runtimeState === "failed" || runtimeState === "error"
                ? "text-error"
                : "text-text-muted",
          )}
        />
        <button
          onClick={handleRestart}
          disabled={restarting}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-error/10 text-error text-xs hover:bg-error/20 disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" />
          {restarting ? "Restarting..." : "Restart Pod"}
        </button>
      </div>

      {/* Pod info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">State</div>
          <div className="text-sm capitalize">{runtimeState}</div>
        </div>
        <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Repo</div>
          <div className="text-sm flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {repoName}
          </div>
        </div>
        <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Active Tasks
          </div>
          <div className="text-sm flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {pod.activeTaskCount}
          </div>
        </div>
        <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Created</div>
          <div className="text-sm flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(pod.createdAt)}
          </div>
        </div>
      </div>

      {pod.runtimeStatus?.startedAt && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Started</div>
            <div className="text-xs">{new Date(pod.runtimeStatus.startedAt).toLocaleString()}</div>
          </div>
          {pod.lastTaskAt && (
            <div className="p-3 rounded-xl border border-border/50 bg-bg-card">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Last Task
              </div>
              <div className="text-xs">{formatRelativeTime(pod.lastTaskAt)}</div>
            </div>
          )}
        </div>
      )}

      {pod.errorMessage && (
        <div className="p-3 rounded-lg border border-error/20 bg-error/5 text-error text-sm">
          {pod.errorMessage}
        </div>
      )}

      {/* Tasks on this pod */}
      <div>
        <h2 className="text-sm font-medium text-text-muted mb-3">
          Tasks ({pod.tasks?.length ?? 0})
        </h2>
        {pod.tasks?.length > 0 ? (
          <div className="space-y-1.5">
            {pod.tasks.map((task: any) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="flex items-center justify-between p-3 rounded-md border border-border bg-bg-card hover:bg-bg-hover transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StateBadge state={task.state} />
                  <span className="text-sm truncate">{task.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted shrink-0">
                  <span className="capitalize">{task.agentType?.replace("-", " ")}</span>
                  <span>{formatRelativeTime(task.createdAt)}</span>
                  <ExternalLink className="w-3 h-3" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted text-sm border border-dashed border-border rounded-lg">
            No tasks have run on this pod yet.
          </div>
        )}
      </div>

      {/* Health Events */}
      {healthEvents.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-3">Health Events</h2>
          <div className="space-y-1.5">
            {healthEvents.map((event: any) => (
              <div
                key={event.id}
                className="p-2.5 rounded-md border border-border bg-bg-card text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      event.eventType === "healthy" || event.eventType === "orphan_cleaned"
                        ? "bg-success"
                        : event.eventType === "restarted"
                          ? "bg-warning"
                          : "bg-error",
                    )}
                  />
                  <span className="font-medium capitalize">
                    {event.eventType.replace("_", " ")}
                  </span>
                  <span className="text-text-muted ml-auto">
                    {formatRelativeTime(event.createdAt)}
                  </span>
                </div>
                {event.message && <p className="text-text-muted mt-1 ml-4">{event.message}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
