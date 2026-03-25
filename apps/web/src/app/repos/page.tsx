"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { Loader2, FolderGit2, Lock, Globe, ChevronRight, Settings2, Plus } from "lucide-react";

export default function ReposPage() {
  usePageTitle("Repositories");
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listRepos()
      .then((res) => setRepos(res.repos))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
        <Link
          href="/repos/new"
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Repository
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : repos.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <FolderGit2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No repositories configured</p>
          <p className="text-xs mt-1">
            <Link href="/repos/new" className="text-primary hover:underline">
              Add a repository
            </Link>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {repos.map((repo: any) => (
            <Link
              key={repo.id}
              href={`/repos/${repo.id}`}
              className="flex items-center justify-between p-5 rounded-xl border border-border/50 bg-bg-card hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FolderGit2 className="w-5 h-5 text-text-muted shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{repo.fullName}</span>
                    {repo.isPrivate ? (
                      <Lock className="w-3 h-3 text-text-muted" />
                    ) : (
                      <Globe className="w-3 h-3 text-text-muted" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                    <span>Branch: {repo.defaultBranch}</span>
                    <span>Image: {repo.imagePreset ?? "base"}</span>
                    {repo.autoMerge && <span className="text-warning">auto-merge</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-text-muted">
                <Settings2 className="w-4 h-4" />
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
