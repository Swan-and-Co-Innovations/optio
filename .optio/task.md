# feat: Log search and export

feat: Log search and export

## Problem

Agent logs can be thousands of lines. Users can't search within logs to find errors or export them for offline analysis.

## Features

### Search

- Search bar in the log viewer component
- Highlight matching lines, jump between results
- Filter by log type (text, tool_use, tool_result, thinking, error)

### Export

- "Export logs" button on task detail page
- Formats: JSON (structured), plaintext, markdown
- Include metadata (task ID, timestamps, cost, PR URL)

### API

- `GET /api/tasks/:id/logs?search=keyword&logType=error` — filtered log retrieval
- `GET /api/tasks/:id/logs/export?format=json` — export endpoint

## Acceptance Criteria

- [ ] In-viewer search with highlight and navigation
- [ ] Log type filtering
- [ ] Export in JSON, plaintext, and markdown formats
- [ ] API supports search and export query params

---

_Optio Task ID: 286403af-9e73-43bc-b84b-e0e0f3bd5a00_
