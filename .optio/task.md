# feat: CI pipeline to build and push agent images to container registry

feat: CI pipeline to build and push agent images to container registry

## Problem

Agent images must be built locally with `docker build`. Deploying via Helm to a remote cluster fails because pods can't pull the image — there's no registry.

## Solution

Add a GitHub Actions workflow that:

1. Builds all image presets (base, node, python, go, rust, full) on push to `main` and on tags
2. Pushes to `ghcr.io/jonwiggins/optio-agent-{preset}:{version}`
3. Tags with `latest` + git SHA + semver tag (if applicable)

Update Helm chart defaults:

- Change default image refs to `ghcr.io/jonwiggins/optio-agent-node:latest`
- Change default `imagePullPolicy` to `IfNotPresent`
- Local dev keeps `imagePullPolicy: Never` via `.env`

## Acceptance Criteria

- [ ] GitHub Actions workflow builds and pushes all image presets
- [ ] Images tagged with `latest` and git SHA
- [ ] Helm chart references registry images by default
- [ ] Local dev still uses local builds

---

*Optio Task ID: 8fd19594-a893-40d5-83c3-ddd95e3033ee*
