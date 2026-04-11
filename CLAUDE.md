# CLAUDE.md

## Project Overview

Offline Claude Code plugin marketplace manager. Downloads marketplace repos and plugins on a networked machine, exports them as zip packages for air-gapped installation.

## Tech Stack

- **Backend**: Node.js + TypeScript + Express + better-sqlite3 (WAL mode)
- **Frontend**: React + TypeScript + Vite (SPA, inline styles)
- **Workers**: `worker_threads` for git clone/pull and zip packaging
- **Real-time**: Server-Sent Events (SSE) for task/export progress
- **Git**: `simple-git` library with `outputHandler` for progress streaming

## Architecture

- `server/` — Express API server
  - `db.ts` — SQLite schema (marketplaces, plugins, tasks, exports)
  - `services/task-scheduler.ts` — Concurrency control (max 20 git ops), parent-child task lifecycle
  - `services/marketplace-service.ts` — CRUD + `persistCloneResults` with metadata fallback
  - `services/plugin-service.ts` — Parses `marketplace.json` and `plugin.json`, supports all source types
  - `workers/clone-worker.ts` — Git clone/pull in worker threads (marketplace + plugin modes)
  - `workers/export-worker.ts` — Zip packaging
  - `routes/` — REST endpoints
- `client/src/` — React SPA
  - `pages/` — MarketplaceList, MarketplaceDetail, TaskList, ExportList, ExportNew, ExportDetail
  - `components/` — Shared UI (StatusBadge, ProgressBar, SearchInput, ConfirmModal, Toast)
- `data/` — Runtime data (SQLite DB, cloned repos, exports). Gitignored.

## Key Concepts

- **Branch-as-marketplace**: Each (repo_url, branch) pair is a separate marketplace record. Max 5 branches per repo.
- **Child task architecture**: Marketplace clone creates child tasks for each external plugin. Parent stays `running` until all children complete.
- **Plugin source types**: `local` (in marketplace repo), `github`, `url`, `git-subdir` (sparse-checkout)
- **Metadata fallback**: Plugin metadata from `plugin.json` takes priority; falls back to marketplace.json entry fields.
- **Fallback discovery**: Repos without `marketplace.json` but with `.claude-plugin/plugin.json` are treated as single-plugin marketplaces.
- **No FK constraints**: Referential integrity managed in application code.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev mode (Vite + tsx, hot reload)
npm run build        # Production build
npm start            # Start production server (port 3001)
npx vitest run       # Run all tests
npx vitest           # Watch mode
npx tsc --noEmit     # Type check
```

## Testing

- Uses vitest + supertest
- Test DB files created in `data/test-*.sqlite`, cleaned up in afterEach
- No mocking of git operations in unit tests — clone worker tested via integration
- Known flaky: SQLite WAL contention when all test files run concurrently (re-run usually passes)

## Database

Schema changes require deleting `data/db.sqlite*` — no migration system. Tables: `marketplaces`, `plugins`, `tasks`, `exports`.
