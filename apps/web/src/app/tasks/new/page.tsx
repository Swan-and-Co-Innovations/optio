"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { api } from "@/lib/api-client";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function NewTaskPage() {
  usePageTitle("New Task");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<any[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [form, setForm] = useState({
    title: "",
    prompt: "",
    repoId: "",
    repoUrl: "",
    repoBranch: "main",
    agentType: "claude-code",
    maxRetries: 3,
    priority: 100,
  });

  useEffect(() => {
    api
      .listRepos()
      .then((res) => {
        setRepos(res.repos);
        if (res.repos.length > 0) {
          const first = res.repos[0];
          setForm((f) => ({
            ...f,
            repoId: first.id,
            repoUrl: first.repoUrl,
            repoBranch: first.defaultBranch ?? "main",
          }));
        }
      })
      .catch(() => {})
      .finally(() => setReposLoading(false));
  }, []);

  const handleRepoChange = (repoId: string) => {
    const repo = repos.find((r: any) => r.id === repoId);
    if (repo) {
      setForm((f) => ({
        ...f,
        repoId: repo.id,
        repoUrl: repo.repoUrl,
        repoBranch: repo.defaultBranch ?? "main",
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.createTask({
        title: form.title,
        prompt: form.prompt,
        repoUrl: form.repoUrl,
        repoBranch: form.repoBranch,
        agentType: form.agentType,
        maxRetries: form.maxRetries,
        priority: form.priority,
      });
      toast.success("Task created", { description: `Task "${form.title}" has been queued.` });
      router.push(`/tasks/${res.task.id}`);
    } catch (err) {
      toast.error("Failed to create task", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedRepo = repos.find((r: any) => r.id === form.repoId);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Create New Task</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Repository */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Repository</label>
          {reposLoading ? (
            <div className="flex items-center gap-2 text-text-muted text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading repos...
            </div>
          ) : repos.length > 0 ? (
            <select
              required
              value={form.repoId}
              onChange={(e) => handleRepoChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            >
              {repos.map((repo: any) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName} ({repo.defaultBranch})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-text-muted py-2">
              No repos configured.{" "}
              <a href="/repos" className="text-primary hover:underline">
                Add a repo
              </a>{" "}
              first.
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Title</label>
          <input
            type="text"
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Add input validation to user registration"
            className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Task Description</label>
          <textarea
            required
            rows={6}
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            placeholder="Describe what the agent should do. Be specific about requirements, files to modify, and expected behavior."
            className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors resize-y"
          />
        </div>

        {/* Branch + Agent Type row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Branch</label>
            <input
              type="text"
              value={form.repoBranch}
              onChange={(e) => setForm((f) => ({ ...f, repoBranch: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Agent</label>
            <select
              value={form.agentType}
              onChange={(e) => setForm((f) => ({ ...f, agentType: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">OpenAI Codex</option>
            </select>
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Priority</label>
          <p className="text-xs text-text-muted/60 mb-1.5">
            Lower number = higher priority. Default is 100.
          </p>
          <input
            type="number"
            min={1}
            max={1000}
            value={form.priority}
            onChange={(e) =>
              setForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 100 }))
            }
            className="w-24 px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !form.repoUrl}
          className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {loading ? "Creating..." : "Create Task"}
        </button>
      </form>
    </div>
  );
}
