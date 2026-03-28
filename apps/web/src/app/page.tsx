"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { RefreshCw, MessageSquare } from "lucide-react";
import {
  PipelineStatsBar,
  UsagePanel,
  ClusterSummary,
  ActiveSessions,
  RecentTasks,
  PodsList,
  WelcomeHero,
} from "@/components/dashboard";
import { useOptioChatStore } from "@/components/optio-chat/optio-chat-store.js";

export default function OverviewPage() {
  usePageTitle("Overview");
  const {
    taskStats,
    recentTasks,
    repoCount,
    cluster,
    loading,
    activeSessions,
    activeSessionCount,
    usage,
    metricsAvailable,
    metricsHistory,
    refresh,
  } = useDashboardData();

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="h-8 w-40 skeleton-shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 skeleton-shimmer" />
          ))}
        </div>
        <div className="h-16 skeleton-shimmer" />
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 skeleton-shimmer" />
            ))}
          </div>
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 skeleton-shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isFirstRun = (taskStats?.total ?? 0) === 0;
  if (isFirstRun) {
    return <WelcomeHero repoCount={repoCount ?? 0} />;
  }

  const totalCost = recentTasks.reduce((sum: number, t: any) => {
    return sum + (t.costUsd ? parseFloat(t.costUsd) : 0);
  }, 0);

  const {
    pods,
    events,
    repoPods: repoPodRecords,
  } = cluster ?? {
    pods: [],
    events: [],
    repoPods: [],
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient">Overview</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {taskStats?.running ?? 0} active {(taskStats?.running ?? 0) === 1 ? "task" : "tasks"}
            {activeSessionCount > 0 && (
              <span className="text-primary">
                {" \u00B7 "}
                {activeSessionCount} {activeSessionCount === 1 ? "session" : "sessions"}
              </span>
            )}
            {(taskStats?.needsAttention ?? 0) > 0 && (
              <span className="text-warning">
                {" \u00B7 "}
                {taskStats?.needsAttention} need
                {(taskStats?.needsAttention ?? 0) === 1 ? "s" : ""} attention
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-muted transition-all btn-press hover:text-text"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <PipelineStatsBar taskStats={taskStats} />

      <DashboardOptioPrompt failedCount={taskStats?.failed ?? 0} />

      <UsagePanel usage={usage} />

      <ClusterSummary
        cluster={cluster}
        totalCost={totalCost}
        metricsAvailable={metricsAvailable}
        metricsHistory={metricsHistory}
      />

      <ActiveSessions sessions={activeSessions} activeCount={activeSessionCount} />

      <div className="grid md:grid-cols-2 gap-8">
        <RecentTasks tasks={recentTasks} />
        <PodsList
          pods={pods}
          events={events}
          recentTasks={recentTasks}
          repoPodRecords={repoPodRecords ?? []}
        />
      </div>
    </div>
  );
}

function DashboardOptioPrompt({ failedCount }: { failedCount: number }) {
  const openWithPrefill = useOptioChatStore((s) => s.openWithPrefill);

  if (failedCount === 0) return null;

  return (
    <button
      onClick={() =>
        openWithPrefill(
          `${failedCount} task${failedCount === 1 ? "" : "s"} failed today. Can you help me understand what went wrong?`,
        )
      }
      className="w-full rounded-md border border-warning/20 bg-warning/5 px-4 py-3 flex items-center gap-3 hover:bg-warning/10 transition-colors text-left group"
    >
      <MessageSquare className="w-4 h-4 text-warning/60 shrink-0 group-hover:text-warning transition-colors" />
      <span className="text-sm text-warning/80 group-hover:text-warning transition-colors">
        {failedCount} task{failedCount === 1 ? "" : "s"} failed today &mdash; ask Optio to help?
      </span>
    </button>
  );
}
