# Local Claude Code Plugin Marketplace - Design Spec

**Date:** 2026-04-09
**Status:** Approved

## Overview

A web application that downloads Claude Code plugin marketplaces from GitHub on a connected machine, and exports them as self-contained offline packages. The offline package is extracted on an air-gapped machine and installed into Claude Code via local path.

The web app runs **only on the connected machine**. The offline environment requires no web app — just the extracted zip and an install script.

---

## Background

Claude Code supports adding plugin marketplaces from several sources, including local filesystem paths:

```
/plugin marketplace add ./path/to/marketplace
```

When a marketplace is cloned from GitHub, its `marketplace.json` may reference plugins via relative paths (already in the repo) or via external GitHub/git URLs. To make everything available offline, all external plugin repos must also be cloned and their sources rewritten to local relative paths in the exported `marketplace.json`.

---

## Tech Stack

- **Backend:** Node.js + TypeScript, Express
- **Frontend:** React + TypeScript
- **Storage:** SQLite (metadata), local filesystem (git repos and export zips)
- **Async:** Node.js Worker Threads for git operations and packaging
- **Real-time:** Server-Sent Events (SSE) for download/export progress
- **Distribution:** npm (`npm install && npm start`) — no Docker required

---

## Architecture

```
local-cc-plugin-marketplace/
├── server/          # Express + TypeScript backend
├── client/          # React frontend
├── data/            # Runtime data (git-ignored)
│   ├── repos/       # Cloned marketplace and plugin repos
│   ├── exports/     # Generated export zip files
│   └── db.sqlite    # Metadata database
└── package.json
```

### Request Flow (Download)

1. User inputs GitHub URL in the frontend → `POST /api/marketplaces`
2. Backend creates a task record and dispatches to Worker Thread; returns task ID immediately
3. Frontend subscribes to `GET /api/tasks/:id/events` (SSE) for real-time progress
4. Worker executes sequentially:
   - `git clone` the marketplace repo
   - Parse `.claude-plugin/marketplace.json`
   - For each plugin with an external source URL: `git clone` the plugin repo
   - Read `.claude-plugin/plugin.json` from each plugin, write metadata to SQLite
5. Task completes; frontend refreshes marketplace list

### Request Flow (Export)

1. User selects marketplaces and plugin subsets on the export page → `POST /api/exports`
2. Backend creates an export record (status: `packaging`) and dispatches to Worker Thread
3. Frontend subscribes to SSE progress on the export record
4. Worker builds the zip:
   - Per marketplace: create directory, copy selected plugin directories
   - Rewrite `marketplace.json` to contain only selected plugins with sources rewritten to local relative paths
   - Generate `install.sh`, `install.bat`, `install.ps1`
   - Generate `README.md`
5. Export record updated to `ready` with zip path and size; frontend shows download button
6. If total export records exceed 20, delete the oldest record and its zip file

---

## Data Model

### `marketplaces`

| Field | Type | Description |
|-------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Marketplace name (from marketplace.json) |
| source_url | TEXT | Original GitHub URL or git URL |
| local_path | TEXT | Absolute path to cloned repo |
| status | TEXT | `pending` / `cloning` / `ready` / `error` |
| description | TEXT | From marketplace.json |
| owner | TEXT | From marketplace.json owner field |
| git_commit_sha | TEXT | Current HEAD commit SHA |
| last_updated | DATETIME | Last successful clone/refresh |
| created_at | DATETIME | When first added |

### `plugins`

| Field | Type | Description |
|-------|------|-------------|
| id | TEXT (UUID) | Primary key |
| marketplace_id | TEXT | Foreign key → marketplaces.id |
| name | TEXT | Plugin name |
| version | TEXT | Semantic version |
| author | TEXT | Author name |
| author_url | TEXT | Author URL (optional) |
| description | TEXT | Plugin description |
| keywords | TEXT | JSON array of keyword strings |
| homepage | TEXT | Homepage URL |
| license | TEXT | SPDX license identifier |
| source_type | TEXT | `local` (relative path in marketplace) or `external` (separate git repo) |
| source_url | TEXT | Original source URL (if external) |
| local_path | TEXT | Absolute path to plugin directory |
| status | TEXT | `pending` / `cloning` / `ready` / `error` |
| git_commit_sha | TEXT | Current HEAD commit SHA |
| created_at | DATETIME | When first recorded |

### `tasks`

| Field | Type | Description |
|-------|------|-------------|
| id | TEXT (UUID) | Primary key |
| type | TEXT | `clone_marketplace` |
| status | TEXT | `running` / `completed` / `failed` |
| marketplace_id | TEXT | Associated marketplace ID |
| progress | INTEGER | 0–100 |
| message | TEXT | Current status message |
| created_at | DATETIME | Task start time |
| completed_at | DATETIME | Task end time |

### `exports`

| Field | Type | Description |
|-------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | User-supplied name or auto-generated timestamp |
| status | TEXT | `packaging` / `ready` / `failed` |
| progress | INTEGER | 0–100 |
| message | TEXT | Current status message |
| selected_content | TEXT | JSON: `{marketplaceId: [pluginId, ...], ...}` |
| zip_path | TEXT | Absolute path to generated zip file |
| zip_size | INTEGER | Zip file size in bytes |
| created_at | DATETIME | Export creation time |
| completed_at | DATETIME | Packaging completion time |

Maximum 20 export records retained. When a new export is created and would exceed the limit, the oldest record and its zip file are deleted.

---

## API Endpoints

### Marketplaces

```
GET    /api/marketplaces               List all marketplaces (with plugin counts)
POST   /api/marketplaces               Add marketplace (triggers clone task)
DELETE /api/marketplaces/:id           Delete marketplace and local data
POST   /api/marketplaces/:id/refresh   Re-clone / pull updates
GET    /api/marketplaces/:id/plugins   List plugins for a marketplace
```

### Plugins

```
GET    /api/plugins/:id                Plugin detail
```

### Tasks

```
GET    /api/tasks                      Task list
GET    /api/tasks/:id/events           SSE stream for real-time progress
```

### Exports

```
GET    /api/exports                    Export record list
POST   /api/exports                    Create new export (triggers packaging)
GET    /api/exports/:id                Export detail (with included plugin info)
GET    /api/exports/:id/download       Download zip file
DELETE /api/exports/:id                Manually delete export record
```

---

## Frontend Pages

### `/` — Marketplace List
- "Add Marketplace" input (GitHub URL or git URL) with submit button
- Grid of marketplace cards: name, source URL, plugin count, status badge, last updated, Refresh / Delete actions
- Clicking a card navigates to marketplace detail

### `/marketplace/:id` — Marketplace Detail
- Breadcrumb back to list
- Marketplace metadata (name, description, owner, git SHA, last updated)
- Plugin grid — each card displays:
  - Name + version
  - Author (with link if available)
  - Description
  - Keyword tags
  - Status badge (ready / error)
  - Homepage link (if available)

### `/tasks` — Task Progress
- List of download tasks with real-time SSE progress bars
- Shows current step message (e.g., "Cloning external plugin: superpowers")

### `/export/new` — New Export
- Left panel: tree checkbox selector (marketplace → plugins)
- Right panel: summary of selected content (X marketplaces, Y plugins)
- Name field (optional, defaults to timestamp)
- "Start Export" button → navigates to `/export`

### `/export` — Export Records
- List of up to 20 export records
- Each row: name, created time, status, marketplace count, plugin count
- In-progress: SSE real-time progress bar
- Completed: "Download" button + "View Details" link
- Failed: error message + "Delete" action

### `/export/:id` — Export Detail
- Export metadata (name, created time, zip size)
- List of included marketplaces and their selected plugins (card format)
- Download button

---

## Export Package Structure

```
export-YYYY-MM-DD-HHmmss/
├── README.md
├── install.sh          # Linux / macOS
├── install.bat         # Windows CMD
├── install.ps1         # Windows PowerShell
├── marketplace-A/
│   ├── .claude-plugin/
│   │   └── marketplace.json    # Rewritten: only selected plugins, sources as local relative paths
│   └── plugins/
│       ├── plugin-x/
│       └── plugin-y/
└── marketplace-B/
    └── ...
```

### Install Scripts

Each script detects its own directory and prints the Claude Code commands to run.

**install.bat (Windows CMD):**
```bat
@echo off
set DIR=%~dp0
echo Run the following commands in Claude Code:
echo.
echo /plugin marketplace add %DIR%marketplace-A
echo /plugin marketplace add %DIR%marketplace-B
pause
```

**install.ps1 (PowerShell):**
```powershell
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Run the following commands in Claude Code:"
Write-Host ""
Write-Host "/plugin marketplace add $dir\marketplace-A"
Write-Host "/plugin marketplace add $dir\marketplace-B"
```

**install.sh (bash):**
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Run the following commands in Claude Code:"
echo ""
echo "/plugin marketplace add $DIR/marketplace-A"
echo "/plugin marketplace add $DIR/marketplace-B"
```

### README.md Contents

1. What this package contains (list of marketplaces and plugin counts)
2. Prerequisites (Claude Code installed)
3. Installation steps:
   - Extract the zip to any directory
   - Run the appropriate script for your OS to get the install commands
   - Paste each command into Claude Code
4. Notes on script usage per OS (CMD vs PowerShell vs bash)

---

## Key Behaviors

- **Recursive clone:** When a marketplace contains plugins with external source URLs, all external repos are cloned automatically. Progress messages name each repo being cloned.
- **Source rewriting on export:** The exported `marketplace.json` replaces all plugin sources with local relative paths (e.g., `"./plugins/plugin-name"`), regardless of original source type.
- **Partial export:** Users may select any subset of plugins per marketplace. The exported `marketplace.json` contains only the selected plugins.
- **Export record limit:** Maximum 20 records. On creation of a 21st, the oldest record and its zip file are deleted from disk.
- **Refresh:** Re-cloning a marketplace pulls the latest changes and re-reads all plugin metadata. External plugin repos are also updated.
