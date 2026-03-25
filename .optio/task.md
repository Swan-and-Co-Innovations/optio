# fix: Turborepo silently drops web app during pnpm dev

fix: Turborepo silently drops web app during pnpm dev

## Problem

Running `pnpm dev` (which calls `turbo dev`) sometimes only starts the API server — the Next.js web app never launches. No error is shown. The web app works fine when started manually with `cd apps/web && npx next dev`.

## Observed Behavior

- `turbo dev` output only shows `@optio/api:dev` logs
- No `@optio/web:dev` output at all
- API healthy on :4000, web unreachable on :3100
- Seems intermittent — may relate to the `taskQueue.obliterate()` call blocking the event loop early in API startup

## Workaround

Start web manually: `cd apps/web && npx next dev --port 3100`

## Investigation Needed

- Check if turbo is timing out on the web task
- Check if the API's startup is blocking turbo's process management
- May need to split API and web into separate `pnpm dev:api` and `pnpm dev:web` scripts

---

_Optio Task ID: 27c499f3-58d1-4957-b6dc-3652a63caf91_
