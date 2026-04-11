# Iteration 2: Plugin Source Enhancement & Task Granularity

## Goal

Enhance plugin source parsing to support all Claude Code marketplace source types (`git-subdir`, single-plugin repos, metadata fallback), split external plugin clones into individual child tasks, and display detailed git progress output.

## Architecture

Three layers of changes: (1) plugin-service parsing enrichment with metadata fallback, (2) clone-worker restructuring to emit child tasks and support sparse-checkout, (3) git progress streaming via simple-git outputHandler. Database schema changes are additive — no data migration, existing data can be deleted.

## Tech Stack

Express, better-sqlite3, simple-git (outputHandler + sparse-checkout), worker_threads, React, SSE.

---

## 1. Plugin Source Parsing Enhancement

### 1.1 MarketplacePluginEntry Enrichment

Current `MarketplacePluginEntry` only carries `name`, `source_type`, `source_url`, `relative_path`. Extend it to carry marketplace.json metadata that can serve as fallback for plugins lacking their own `plugin.json`.

**New fields on `MarketplacePluginEntry`:**

```typescript
export interface MarketplacePluginEntry {
  name: string
  source_type: 'local' | 'external'
  source_url: string | null
  relative_path: string
  // New fields:
  source_format: 'local' | 'github' | 'url' | 'git-subdir'  // original source type
  subdir_path: string | null      // for git-subdir: the path within the repo
  ref: string | null              // for git-subdir/github: branch/tag reference
  // Fallback metadata from marketplace.json plugin entry
  fallback_description: string | null
  fallback_homepage: string | null
  fallback_keywords: string | null
  fallback_version: string | null
  fallback_author: string | null
}
```

### 1.2 git-subdir URL Normalization

In `parseMarketplaceJson`, when processing `git-subdir` source:

- If `url` does not start with `http://`, `https://`, or `git@`, treat as GitHub shorthand and prepend `https://github.com/` + append `.git`
- Extract `path` → `subdir_path`, `ref` → `ref`
- `sha` is ignored (we always fetch latest)

Same shorthand normalization applies to `github` type (already implemented, just ensure consistency).

### 1.3 Fallback Marketplace Discovery

In `parseMarketplaceJson`, when `.claude-plugin/marketplace.json` does not exist:

1. Check for `.claude-plugin/plugin.json`
2. If found, read it and construct a single-plugin marketplace result:
   - `name` = plugin.json `name`
   - `description` = plugin.json `description`
   - `owner` = plugin.json `author` (name)
   - `plugins` = one entry with `source_type: 'local'`, `relative_path: '.'`
3. If neither file exists, throw error (as today)

### 1.4 Metadata Merge in persistCloneResults

Current logic: read `plugin.json` from each plugin's `local_path`, use its fields directly.

New logic: receive the `MarketplacePluginEntry` fallback metadata alongside each clone result. For each metadata field (`description`, `homepage`, `keywords`, `version`, `author`):

```
final_value = plugin.json_value ?? marketplace_entry_fallback_value ?? null
```

This requires passing fallback metadata through the clone pipeline. See section 2 for how `ClonePluginResult` is extended.

### 1.5 Database Schema Changes

**plugins table** — add two columns:

```sql
source_format TEXT    -- 'local', 'github', 'url', 'git-subdir'
subdir_path TEXT      -- for git-subdir: path within the repo (e.g., 'plugins/ai-firstify')
```

**Plugin type** update:

```typescript
export interface Plugin {
  // ... existing fields ...
  source_format: string | null   // 'local' | 'github' | 'url' | 'git-subdir'
  subdir_path: string | null
}
```

---

## 2. Child Task Architecture

### 2.1 Marketplace Clone Worker Restructuring

**Current behavior**: marketplace worker clones marketplace repo, then serially clones all external plugins in the same worker, then sends `done` with all results.

**New behavior**:

1. Marketplace worker clones marketplace repo
2. Parses marketplace.json (with fallback discovery per 1.3)
3. Collects local plugin results immediately
4. Sends `create_child_tasks` message for each external plugin
5. Sends `marketplace_parsed` message (new type) with:
   - `gitSha`: marketplace repo commit SHA
   - `localPlugins`: array of local plugin results with fallback metadata
   - `pluginEntries`: all `MarketplacePluginEntry` objects (for fallback metadata lookup)

**Why `marketplace_parsed` instead of `done`**: The parent task should NOT be marked `completed` when the marketplace worker finishes — child tasks haven't started yet. `marketplace_parsed` signals the scheduler to persist the marketplace metadata and local plugins, while the parent task stays `running` until all children complete.

### 2.2 Child Task Worker (Plugin Mode) Enhancement

Each child task runs in plugin clone mode. The worker needs additional data:

**Extended workerData for plugin mode:**

```typescript
{
  mode: 'plugin'
  taskId: string
  pluginId?: string
  sourceUrl: string
  branch?: string
  pluginDir: string
  // New fields:
  sourceFormat: 'github' | 'url' | 'git-subdir'
  subdirPath?: string       // for git-subdir only
}
```

**git-subdir clone logic** (new `cloneSubdir` function):

```
1. git clone --filter=blob:none --sparse --branch <ref> <url> <targetDir>
2. cd <targetDir>
3. git sparse-checkout set <subdirPath>
```

This creates a partial clone with only the specified subdirectory checked out.

For non-git-subdir plugins: same full clone as today via `cloneOrPull`.

### 2.3 ClonePluginResult Extension

Add fallback metadata to `ClonePluginResult` so `persistCloneResults` can merge:

```typescript
export interface ClonePluginResult {
  name: string
  source_type: 'local' | 'external'
  source_format: string
  source_url: string | null
  local_path: string
  relative_path: string
  git_commit_sha: string | null
  subdir_path: string | null
  // Fallback metadata
  fallback_description: string | null
  fallback_homepage: string | null
  fallback_keywords: string | null
  fallback_version: string | null
  fallback_author: string | null
}
```

### 2.4 Task Scheduler Changes

**New message type: `marketplace_parsed`**

When the scheduler receives `marketplace_parsed` from a marketplace worker:

1. Store the `gitSha`, `localPlugins`, and `pluginEntries` on the task context (in-memory map or DB)
2. Do NOT mark parent task as `done` — it stays `running`
3. Child tasks created via `create_child_tasks` will execute independently

**Parent task completion trigger**:

In `updateParentStatus`, when all children are `completed`:

1. Gather local plugin results (from `marketplace_parsed` data)
2. Gather child task plugin results (each child's `done` message carries its result)
3. Call `persistCloneResults` with combined results
4. Mark parent as `completed`

**Implementation detail**: Store intermediate results in a new in-memory `Map<string, MarketplaceParsedData>` on the TaskScheduler, keyed by parent task ID. This avoids schema changes for temporary data.

### 2.5 Child Task Creation

The marketplace worker sends `create_child_tasks` with entries like:

```typescript
{
  type: 'create_child_tasks',
  tasks: externalPlugins.map(p => ({
    id: crypto.randomUUID(),
    type: 'clone_plugin',
    marketplace_id: marketplaceId,
    plugin_id: null,
    repo_url: p.source_url,
    branch: p.ref ?? null,
  }))
}
```

The TaskScheduler's existing `create_child_tasks` handler (task-scheduler.ts:236-252) already inserts these into the DB and calls `drainQueue()`.

### 2.6 Worker Data for Child Tasks

In `startWorker`, when starting a `clone_plugin` task that is a child of a marketplace task, the scheduler needs to pass `sourceFormat` and `subdirPath` to the worker. These come from the `pluginEntries` stored during `marketplace_parsed`.

**Approach**: The `create_child_tasks` message includes additional fields per child task that the scheduler stores. Alternatively, encode `sourceFormat` and `subdirPath` in new task DB columns.

**Chosen approach**: Add `source_format` and `subdir_path` columns to the `tasks` table. This is simpler and survives server restarts.

**tasks table** — add two columns:

```sql
source_format TEXT    -- 'github', 'url', 'git-subdir' (for clone_plugin tasks)
subdir_path TEXT      -- path within repo (for git-subdir tasks)
```

**Task type** update:

```typescript
export interface Task {
  // ... existing fields ...
  source_format: string | null
  subdir_path: string | null
}
```

---

## 3. Git Progress Streaming

### 3.1 Capturing Git Progress from simple-git

`simple-git` supports an `outputHandler` that intercepts child process stdout/stderr streams. Git writes progress to stderr.

**Implementation in clone-worker:**

```typescript
const git = simpleGit()
git.outputHandler((command, stdout, stderr) => {
  stderr.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split(/\r|\n/).filter(Boolean)
    for (const line of lines) {
      // Parse progress lines like:
      // "Receiving objects:  45% (297/660), 1.23 MiB | 1.51 MiB/s"
      // "Resolving deltas: 100% (160/160), done."
      post({ type: 'progress', progress: currentProgress, message: line.trim() })
    }
  })
})
```

**Progress message format**: The `message` field in the progress update will contain the raw git line (e.g., `"Receiving objects: 45% (297/660), 1.23 MiB | 1.51 MiB/s"`). The frontend already renders `task.message` — no frontend changes needed for basic display.

### 3.2 Progress Percentage Mapping

For clone operations, map git phases to progress ranges:

- `Enumerating objects`: 5-10%
- `Counting objects`: 10-20%
- `Compressing objects`: 20-30%
- `Receiving objects`: 30-80%
- `Resolving deltas`: 80-95%
- Done: 95-100%

Parse the percentage from the git output line (e.g., `45%` from `Receiving objects: 45%`) and map it to the appropriate range.

For `cloneOrPull` (incremental updates — fetch + pull), similar phases apply but the data volume is typically much smaller.

### 3.3 OutputHandler Scope

The `outputHandler` must be configured on the `simpleGit` instance **before** calling `.clone()` or `.pull()`. Refactor `cloneOrPull` and new `cloneSubdir` to accept a progress callback, and set up the handler accordingly.

**Function signatures:**

```typescript
type ProgressCallback = (message: string, percent?: number) => void

async function cloneOrPull(sourceUrl: string, targetDir: string, branch?: string, onProgress?: ProgressCallback): Promise<void>

async function cloneSubdir(sourceUrl: string, targetDir: string, subdirPath: string, ref?: string, onProgress?: ProgressCallback): Promise<void>
```

---

## 4. Data Flow (End to End)

```
User: Add Marketplace (repo_url, branch)
  │
  ├─ Insert marketplace (status='cloning')
  ├─ Insert parent task (type='clone_marketplace', status='queued')
  └─ scheduler.enqueue()
       │
       ├─ drainQueue() → startWorker(parentTask)
       │    │
       │    └─ clone-worker (marketplace mode):
       │         1. Clone marketplace repo (with git progress streaming)
       │         2. Parse marketplace.json (or fallback to plugin.json)
       │         3. Collect local plugin results
       │         4. Post 'create_child_tasks' for external plugins
       │         5. Post 'marketplace_parsed' with localPlugins + pluginEntries
       │
       ├─ scheduler handles 'create_child_tasks':
       │    Insert child tasks into DB → drainQueue()
       │
       ├─ scheduler handles 'marketplace_parsed':
       │    Store localPlugins + pluginEntries in memory map
       │    Worker exits, but parent stays 'running' (children pending)
       │
       ├─ For each child task → startWorker(childTask):
       │    clone-worker (plugin mode):
       │      - git-subdir: sparse-checkout clone
       │      - github/url: full clone
       │      - Stream git progress
       │      - Post 'done' with { gitSha, pluginName }
       │
       ├─ scheduler handles child 'done':
       │    Store child result → updateParentStatus()
       │
       └─ When all children completed:
            Merge local + child results
            Call persistCloneResults() with fallback metadata
            Parent task → 'completed'
            Marketplace → 'ready'
```

---

## 5. Error Handling

### 5.1 Marketplace Parse Failure

If marketplace.json AND plugin.json are both missing → marketplace worker posts `error` → parent task `failed` → marketplace status `error`. No child tasks created.

### 5.2 Individual Plugin Clone Failure

Child task fails → child status `failed`, but other children continue. Parent status becomes `failed` only after all children finish (if any failed). `persistCloneResults` still runs for successful plugins — failed plugins get `status='error'` in the plugins table.

### 5.3 Partial Results on Parent Failure

Even if some children fail, local plugins and successful external plugins should still be persisted. The marketplace status reflects the overall outcome:
- All plugins succeeded → `ready`
- Some plugins failed → `ready` (plugins that failed have individual `error` status)
- Marketplace clone itself failed → `error`

### 5.4 git-subdir Sparse Checkout Failure

If sparse-checkout fails (e.g., path doesn't exist in repo), the child task fails with an error message. The plugin gets `status='error'`.

---

## 6. Files Changed

### Backend

| File | Change |
|------|--------|
| `server/db.ts` | Add `source_format`, `subdir_path` to `plugins` and `tasks` tables |
| `server/types.ts` | Add `source_format`, `subdir_path` to `Plugin` and `Task` interfaces |
| `server/services/plugin-service.ts` | Extend `MarketplacePluginEntry` with fallback metadata and source details; add fallback marketplace discovery; git-subdir URL normalization |
| `server/workers/clone-worker.ts` | Restructure marketplace mode to emit `create_child_tasks` + `marketplace_parsed`; add `cloneSubdir` for sparse-checkout; add git progress streaming via outputHandler; extend plugin mode with source_format/subdirPath |
| `server/services/task-scheduler.ts` | Handle `marketplace_parsed` message; store intermediate results in memory map; trigger `persistCloneResults` when all children complete; pass source_format/subdir_path to plugin workers |
| `server/services/marketplace-service.ts` | Update `persistCloneResults` to accept and merge fallback metadata; update `onMarketplaceDone` signature |
| `server/index.ts` | Update `onMarketplaceDone` wiring if signature changes |

### Frontend

| File | Change |
|------|--------|
| `client/src/pages/TaskList.tsx` | Git progress messages already rendered via `task.message` — no structural changes needed |
| `client/src/components/ProgressBar.tsx` | May enhance to show multi-line git progress if desired (optional) |

### Database

No migration — delete existing `data/db.sqlite*` files and restart.
