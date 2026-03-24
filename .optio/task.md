# Improve pod naming and add per-repo task indicators to overview

Improve pod naming and add per-repo task indicators to overview

## Description

Two related improvements for observability of the pod-per-repo system:

### 1. Improve workspace pod naming

Pod names should clearly indicate which repository they belong to. Currently pod names are generic, making it hard to identify which repo is running in which pod when viewing the cluster or `kubectl get pods`.

**Suggested format:** `optio-repo-<owner>-<repo>-<short-hash>` (e.g., `optio-repo-jonwiggins-optio-a3f2`)

Constraints:

- Must be valid K8s resource names (lowercase, alphanumeric + hyphens, max 63 chars)
- Must be unique (short hash suffix)
- Should truncate long owner/repo names gracefully

### 2. Add per-repo task indicators to overview panel

The overview page should show at a glance how busy each repo pod is:

- Number of tasks currently **running** in each pod
- Number of tasks **queued** for that repo
- Visual indicator of capacity usage (e.g., 2/3 slots used)

This information already exists in the system (`repo_pods.activeTaskCount`, `repos.maxConcurrentTasks`, and queued tasks can be counted from the `tasks` table), it just needs to be surfaced in the UI.

## Acceptance criteria

- Pod names include a human-readable repo identifier
- Overview panel shows running task count per pod
- Overview panel shows queued task count per repo
- Capacity indicator shows usage vs. `maxConcurrentTasks` limit

---

_Optio Task ID: b6c16293-851f-4a3d-bfbd-b3575146bc2f_
