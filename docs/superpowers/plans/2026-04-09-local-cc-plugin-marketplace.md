# Local CC Plugin Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app that clones Claude Code plugin marketplaces from GitHub, displays them with plugin metadata, and exports selected plugins as offline-installable packages.

**Architecture:** Express + TypeScript backend with SQLite metadata storage and Worker Threads for async git/zip operations; React frontend with SSE for real-time progress; no Docker, distributed via npm.

**Tech Stack:** Node.js 20+, TypeScript, Express, better-sqlite3, simple-git, archiver, React 18, Vite, React Router v6, vitest, supertest

---

## File Map

```
local-cc-plugin-marketplace/
├── package.json
├── tsconfig.json              # base config (used by client)
├── tsconfig.server.json       # server-specific (no DOM, outputs to dist/server)
├── vite.config.ts             # client build config
├── server/
│   ├── index.ts               # Express app entry point
│   ├── db.ts                  # better-sqlite3 setup, schema, migrations
│   ├── types.ts               # Shared TS types (Marketplace, Plugin, Task, Export)
│   ├── routes/
│   │   ├── marketplaces.ts    # GET/POST/DELETE /api/marketplaces, POST /refresh
│   │   ├── plugins.ts         # GET /api/plugins/:id
│   │   ├── tasks.ts           # GET /api/tasks, GET /api/tasks/:id/events (SSE)
│   │   └── exports.ts         # GET/POST/DELETE /api/exports, GET /download
│   ├── services/
│   │   ├── marketplace-service.ts  # add, delete, refresh marketplace logic
│   │   ├── plugin-service.ts       # read plugin.json, parse metadata
│   │   └── export-service.ts       # zip packaging, script generation
│   └── workers/
│       ├── clone-worker.ts    # Worker Thread: git clone + recursive plugin cloning
│       └── export-worker.ts   # Worker Thread: zip creation
├── client/
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx            # Router setup, nav layout
│       ├── api.ts             # fetch wrappers for all API endpoints
│       ├── pages/
│       │   ├── MarketplaceList.tsx
│       │   ├── MarketplaceDetail.tsx
│       │   ├── TaskList.tsx
│       │   ├── ExportNew.tsx
│       │   ├── ExportList.tsx
│       │   └── ExportDetail.tsx
│       └── components/
│           ├── MarketplaceCard.tsx
│           ├── PluginCard.tsx
│           ├── ProgressBar.tsx
│           └── StatusBadge.tsx
├── tests/
│   ├── db.test.ts
│   ├── plugin-service.test.ts
│   ├── export-service.test.ts
│   └── routes/
│       ├── marketplaces.test.ts
│       ├── tasks.test.ts
│       └── exports.test.ts
└── data/                      # git-ignored runtime data
    ├── repos/
    ├── exports/
    └── db.sqlite
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `.gitignore`
- Create: `data/.gitkeep`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "local-cc-plugin-marketplace",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "tsc -p tsconfig.server.json && vite build",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "archiver": "^7.0.1",
    "better-sqlite3": "^9.4.3",
    "cors": "^2.8.5",
    "express": "^4.18.3",
    "simple-git": "^3.22.0"
  },
  "devDependencies": {
    "@types/archiver": "^6.0.2",
    "@types/better-sqlite3": "^7.6.8",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.30",
    "@types/react": "^18.2.70",
    "@types/react-dom": "^18.2.22",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-react": "^4.2.1",
    "concurrently": "^8.2.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.3",
    "supertest": "^6.3.4",
    "tsx": "^4.7.1",
    "typescript": "^5.4.3",
    "vite": "^5.2.2",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (base, used by Vite for client)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["client/src"]
}
```

- [ ] **Step 3: Create tsconfig.server.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/server",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022"]
  },
  "include": ["server"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
data/repos/
data/exports/
data/db.sqlite
```

- [ ] **Step 6: Create data directory placeholders**

```bash
mkdir -p data/repos data/exports
touch data/.gitkeep data/repos/.gitkeep data/exports/.gitkeep
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: project setup with TypeScript, Express, React, Vite"
```

---

## Task 2: Database Setup

**Files:**
- Create: `server/types.ts`
- Create: `server/db.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Create shared types**

Create `server/types.ts`:

```typescript
export type MarketplaceStatus = 'pending' | 'cloning' | 'ready' | 'error'
export type PluginStatus = 'pending' | 'cloning' | 'ready' | 'error'
export type TaskStatus = 'running' | 'completed' | 'failed'
export type ExportStatus = 'packaging' | 'ready' | 'failed'

export interface Marketplace {
  id: string
  name: string
  source_url: string
  local_path: string
  status: MarketplaceStatus
  description: string | null
  owner: string | null
  git_commit_sha: string | null
  last_updated: string | null
  created_at: string
}

export interface Plugin {
  id: string
  marketplace_id: string
  name: string
  version: string | null
  author: string | null
  author_url: string | null
  description: string | null
  keywords: string | null   // JSON array string
  homepage: string | null
  license: string | null
  source_type: 'local' | 'external'
  source_url: string | null
  local_path: string
  status: PluginStatus
  git_commit_sha: string | null
  created_at: string
}

export interface Task {
  id: string
  type: 'clone_marketplace'
  status: TaskStatus
  marketplace_id: string
  progress: number
  message: string | null
  created_at: string
  completed_at: string | null
}

export interface Export {
  id: string
  name: string
  status: ExportStatus
  progress: number
  message: string | null
  selected_content: string   // JSON: { marketplaceId: pluginId[] }
  zip_path: string | null
  zip_size: number | null
  created_at: string
  completed_at: string | null
}
```

- [ ] **Step 2: Write failing db test**

Create `tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../server/db.js'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB_PATH = join(process.cwd(), 'data', 'test-db.sqlite')

let db: Db

beforeEach(() => {
  db = createDb(TEST_DB_PATH)
})

afterEach(async () => {
  db.close()
  await rm(TEST_DB_PATH, { force: true })
})

describe('createDb', () => {
  it('creates all required tables', () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('marketplaces')
    expect(names).toContain('plugins')
    expect(names).toContain('tasks')
    expect(names).toContain('exports')
  })

  it('is idempotent - calling createDb twice does not throw', () => {
    db.close()
    const db2 = createDb(TEST_DB_PATH)
    db2.close()
    db = createDb(TEST_DB_PATH)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/db.test.ts
```

Expected: FAIL with "Cannot find module '../server/db.js'"

- [ ] **Step 4: Create server/db.ts**

```typescript
import Database from 'better-sqlite3'

export type Db = InstanceType<typeof Database>

export function createDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      local_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      description TEXT,
      owner TEXT,
      git_commit_sha TEXT,
      last_updated TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      marketplace_id TEXT NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT,
      author TEXT,
      author_url TEXT,
      description TEXT,
      keywords TEXT,
      homepage TEXT,
      license TEXT,
      source_type TEXT NOT NULL,
      source_url TEXT,
      local_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      git_commit_sha TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      marketplace_id TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'packaging',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      selected_content TEXT NOT NULL,
      zip_path TEXT,
      zip_size INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `)

  return db
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/db.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add server/types.ts server/db.ts tests/db.test.ts
git commit -m "feat: database schema and shared types"
```

---

## Task 3: Plugin Service

**Files:**
- Create: `server/services/plugin-service.ts`
- Create: `tests/plugin-service.test.ts`

The plugin service reads `.claude-plugin/plugin.json` from a cloned directory and returns structured metadata.

- [ ] **Step 1: Write failing test**

Create `tests/plugin-service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readPluginJson, parseMarketplaceJson } from '../server/services/plugin-service.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(process.cwd(), 'data', 'test-plugin-fixtures')

beforeAll(() => {
  // Create a fake plugin directory
  mkdirSync(join(TMP, 'my-plugin', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'my-plugin', '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'my-plugin',
      description: 'A test plugin',
      version: '1.2.3',
      author: { name: 'Alice', url: 'https://alice.dev' },
      keywords: ['testing', 'demo'],
      homepage: 'https://example.com',
      license: 'MIT',
    })
  )

  // Create a fake marketplace with two plugins
  mkdirSync(join(TMP, 'my-market', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'my-market', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'my-market',
      description: 'Test marketplace',
      owner: { name: 'Bob' },
      plugins: [
        { name: 'local-plugin', source: './plugins/local-plugin' },
        { name: 'ext-plugin', source: { source: 'github', repo: 'owner/repo' } },
      ],
    })
  )
})

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('readPluginJson', () => {
  it('reads and returns plugin metadata', async () => {
    const result = await readPluginJson(join(TMP, 'my-plugin'))
    expect(result.name).toBe('my-plugin')
    expect(result.version).toBe('1.2.3')
    expect(result.author).toBe('Alice')
    expect(result.author_url).toBe('https://alice.dev')
    expect(result.keywords).toBe('["testing","demo"]')
    expect(result.license).toBe('MIT')
  })

  it('returns null for missing fields gracefully', async () => {
    mkdirSync(join(TMP, 'bare-plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(TMP, 'bare-plugin', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'bare-plugin' })
    )
    const result = await readPluginJson(join(TMP, 'bare-plugin'))
    expect(result.name).toBe('bare-plugin')
    expect(result.version).toBeNull()
    expect(result.author).toBeNull()
  })
})

describe('parseMarketplaceJson', () => {
  it('extracts marketplace metadata and plugin list', async () => {
    const result = await parseMarketplaceJson(join(TMP, 'my-market'))
    expect(result.name).toBe('my-market')
    expect(result.description).toBe('Test marketplace')
    expect(result.owner).toBe('Bob')
    expect(result.plugins).toHaveLength(2)
    expect(result.plugins[0].name).toBe('local-plugin')
    expect(result.plugins[0].source_type).toBe('local')
    expect(result.plugins[1].source_type).toBe('external')
    expect(result.plugins[1].source_url).toBe('https://github.com/owner/repo.git')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/plugin-service.test.ts
```

Expected: FAIL with "Cannot find module '../server/services/plugin-service.js'"

- [ ] **Step 3: Implement plugin-service.ts**

Create `server/services/plugin-service.ts`:

```typescript
import { readFile } from 'fs/promises'
import { join } from 'path'

export interface PluginJsonResult {
  name: string
  version: string | null
  author: string | null
  author_url: string | null
  description: string | null
  keywords: string | null
  homepage: string | null
  license: string | null
}

export interface MarketplacePluginEntry {
  name: string
  source_type: 'local' | 'external'
  source_url: string | null
  relative_path: string  // relative path within marketplace repo
}

export interface MarketplaceJsonResult {
  name: string
  description: string | null
  owner: string | null
  plugins: MarketplacePluginEntry[]
}

export async function readPluginJson(pluginDir: string): Promise<PluginJsonResult> {
  const raw = await readFile(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
  const json = JSON.parse(raw)
  return {
    name: json.name ?? '',
    version: json.version ?? null,
    author: typeof json.author === 'object' ? (json.author?.name ?? null) : (json.author ?? null),
    author_url: typeof json.author === 'object' ? (json.author?.url ?? null) : null,
    description: json.description ?? null,
    keywords: json.keywords ? JSON.stringify(json.keywords) : null,
    homepage: json.homepage ?? null,
    license: json.license ?? null,
  }
}

export async function parseMarketplaceJson(marketplaceDir: string): Promise<MarketplaceJsonResult> {
  const raw = await readFile(join(marketplaceDir, '.claude-plugin', 'marketplace.json'), 'utf-8')
  const json = JSON.parse(raw)

  const plugins: MarketplacePluginEntry[] = (json.plugins ?? []).map((p: any) => {
    if (typeof p.source === 'string') {
      // Local relative path
      const rel = p.source.startsWith('./') ? p.source.slice(2) : p.source
      return {
        name: p.name,
        source_type: 'local' as const,
        source_url: null,
        relative_path: rel,
      }
    } else if (p.source?.source === 'github') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: `https://github.com/${p.source.repo}.git`,
        relative_path: `plugins/${p.name}`,
      }
    } else if (p.source?.source === 'url') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: p.source.url,
        relative_path: `plugins/${p.name}`,
      }
    } else if (p.source?.source === 'git-subdir') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: p.source.url,
        relative_path: `plugins/${p.name}`,
      }
    }
    return {
      name: p.name,
      source_type: 'local' as const,
      source_url: null,
      relative_path: `plugins/${p.name}`,
    }
  })

  return {
    name: json.name ?? '',
    description: json.description ?? null,
    owner: json.owner?.name ?? null,
    plugins,
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/plugin-service.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/plugin-service.ts tests/plugin-service.test.ts
git commit -m "feat: plugin-service reads plugin.json and marketplace.json"
```

---

## Task 4: Clone Worker

**Files:**
- Create: `server/workers/clone-worker.ts`

The clone worker runs in a Worker Thread. It receives a marketplace URL and data directory path via `workerData`, then:
1. Clones the marketplace repo
2. Parses marketplace.json to find external plugins
3. Clones each external plugin repo
4. Reports progress via `parentPort.postMessage`

No unit test for the worker itself (it requires git and network). It will be tested via integration in Task 5.

- [ ] **Step 1: Create clone-worker.ts**

Create `server/workers/clone-worker.ts`:

```typescript
import { workerData, parentPort } from 'worker_threads'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { parseMarketplaceJson } from '../services/plugin-service.js'

export interface CloneWorkerInput {
  marketplaceId: string
  sourceUrl: string
  reposDir: string       // e.g. data/repos
}

export type CloneWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; gitSha: string; plugins: ClonePluginResult[] }
  | { type: 'error'; message: string }

export interface ClonePluginResult {
  name: string
  source_type: 'local' | 'external'
  source_url: string | null
  local_path: string
  relative_path: string
  git_commit_sha: string | null
}

function post(msg: CloneWorkerMessage) {
  parentPort?.postMessage(msg)
}

async function getHeadSha(repoPath: string): Promise<string | null> {
  try {
    const git = simpleGit(repoPath)
    const log = await git.log({ maxCount: 1 })
    return log.latest?.hash ?? null
  } catch {
    return null
  }
}

async function run() {
  const { marketplaceId, sourceUrl, reposDir } = workerData as CloneWorkerInput

  const marketplaceDir = join(reposDir, 'marketplaces', marketplaceId)

  try {
    // Step 1: Clone marketplace repo
    post({ type: 'progress', progress: 5, message: `Cloning marketplace from ${sourceUrl}` })

    await mkdir(join(reposDir, 'marketplaces'), { recursive: true })

    if (existsSync(marketplaceDir)) {
      // Already cloned — pull latest
      const git = simpleGit(marketplaceDir)
      await git.pull()
    } else {
      await simpleGit().clone(sourceUrl, marketplaceDir)
    }

    post({ type: 'progress', progress: 40, message: 'Marketplace cloned, reading plugin list' })

    // Step 2: Parse marketplace.json
    const marketplaceMeta = await parseMarketplaceJson(marketplaceDir)
    const externalPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'external')
    const localPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'local')

    const results: ClonePluginResult[] = []

    // Local plugins already exist in marketplace repo
    for (const p of localPlugins) {
      const localPath = join(marketplaceDir, p.relative_path)
      results.push({
        name: p.name,
        source_type: 'local',
        source_url: null,
        local_path: localPath,
        relative_path: p.relative_path,
        git_commit_sha: null,
      })
    }

    // Step 3: Clone external plugins
    const pluginsBaseDir = join(reposDir, 'plugins', marketplaceId)
    await mkdir(pluginsBaseDir, { recursive: true })

    for (let i = 0; i < externalPlugins.length; i++) {
      const plugin = externalPlugins[i]
      const pluginDir = join(pluginsBaseDir, plugin.name)
      const progressPct = 40 + Math.round(((i + 1) / externalPlugins.length) * 55)

      post({
        type: 'progress',
        progress: progressPct,
        message: `Cloning plugin ${i + 1}/${externalPlugins.length}: ${plugin.name}`,
      })

      try {
        if (existsSync(pluginDir)) {
          const git = simpleGit(pluginDir)
          await git.pull()
        } else {
          await simpleGit().clone(plugin.source_url!, pluginDir)
        }
        const sha = await getHeadSha(pluginDir)
        results.push({
          name: plugin.name,
          source_type: 'external',
          source_url: plugin.source_url,
          local_path: pluginDir,
          relative_path: plugin.relative_path,
          git_commit_sha: sha,
        })
      } catch (err: any) {
        // Non-fatal: record error but continue with other plugins
        post({
          type: 'progress',
          progress: progressPct,
          message: `Warning: failed to clone ${plugin.name}: ${err.message}`,
        })
        results.push({
          name: plugin.name,
          source_type: 'external',
          source_url: plugin.source_url,
          local_path: pluginDir,
          relative_path: plugin.relative_path,
          git_commit_sha: null,
        })
      }
    }

    const marketplaceGitSha = await getHeadSha(marketplaceDir)
    post({ type: 'done', gitSha: marketplaceGitSha ?? '', plugins: results })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

run()
```

- [ ] **Step 2: Commit**

```bash
git add server/workers/clone-worker.ts
git commit -m "feat: clone worker thread for marketplace and plugin git cloning"
```

---

## Task 5: Marketplace Service + Routes

**Files:**
- Create: `server/services/marketplace-service.ts`
- Create: `server/routes/marketplaces.ts`
- Create: `tests/routes/marketplaces.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/routes/marketplaces.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import type { Express } from 'express'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-marketplaces.sqlite')
let app: Express

beforeEach(() => {
  app = createApp(TEST_DB)
})

afterEach(async () => {
  await rm(TEST_DB, { force: true })
})

describe('GET /api/marketplaces', () => {
  it('returns empty array when no marketplaces', async () => {
    const res = await request(app).get('/api/marketplaces')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('POST /api/marketplaces', () => {
  it('rejects missing source_url', async () => {
    const res = await request(app).post('/api/marketplaces').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('creates marketplace record and returns task id', async () => {
    const res = await request(app)
      .post('/api/marketplaces')
      .send({ source_url: 'https://github.com/owner/repo.git' })
    expect(res.status).toBe(202)
    expect(res.body.marketplace_id).toBeDefined()
    expect(res.body.task_id).toBeDefined()
  })
})

describe('DELETE /api/marketplaces/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/marketplaces/nonexistent')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/routes/marketplaces.test.ts
```

Expected: FAIL with "Cannot find module '../../server/index.js'"

- [ ] **Step 3: Create marketplace-service.ts**

Create `server/services/marketplace-service.ts`:

```typescript
import { Worker } from 'worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import { readPluginJson } from './plugin-service.js'
import type { CloneWorkerMessage, ClonePluginResult } from '../workers/clone-worker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function now() { return new Date().toISOString() }
function uuid() { return crypto.randomUUID() }

export function addMarketplace(db: Db, sourceUrl: string, reposDir: string): { marketplace_id: string; task_id: string } {
  const marketplace_id = uuid()
  const task_id = uuid()
  const localPath = join(reposDir, 'marketplaces', marketplace_id)

  db.prepare(`INSERT INTO marketplaces (id, name, source_url, local_path, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(marketplace_id, sourceUrl, sourceUrl, localPath, now())

  db.prepare(`INSERT INTO tasks (id, type, status, marketplace_id, progress, created_at)
    VALUES (?, 'clone_marketplace', 'running', ?, 0, ?)`
  ).run(task_id, marketplace_id, now())

  // Spawn worker
  const workerPath = join(__dirname, '..', 'workers', 'clone-worker.js')
  const worker = new Worker(workerPath, {
    workerData: { marketplaceId: marketplace_id, sourceUrl, reposDir },
  })

  db.prepare(`UPDATE marketplaces SET status='cloning' WHERE id=?`).run(marketplace_id)

  worker.on('message', async (msg: CloneWorkerMessage) => {
    if (msg.type === 'progress') {
      db.prepare(`UPDATE tasks SET progress=?, message=? WHERE id=?`)
        .run(msg.progress, msg.message, task_id)
    } else if (msg.type === 'done') {
      await persistCloneResults(db, marketplace_id, msg.gitSha, msg.plugins)
      db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`)
        .run(now(), task_id)
    } else if (msg.type === 'error') {
      db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(marketplace_id)
      db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run(msg.message, now(), task_id)
    }
  })

  worker.on('error', (err) => {
    db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(marketplace_id)
    db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
      .run(err.message, now(), task_id)
  })

  return { marketplace_id, task_id }
}

async function persistCloneResults(db: Db, marketplace_id: string, gitSha: string, plugins: ClonePluginResult[]) {
  // Read marketplace meta from its plugin.json (marketplace.json name field)
  const marketplace = db.prepare(`SELECT local_path FROM marketplaces WHERE id=?`).get(marketplace_id) as { local_path: string }

  let name = marketplace_id
  let description: string | null = null
  let owner: string | null = null
  try {
    const { parseMarketplaceJson } = await import('./plugin-service.js')
    const meta = await parseMarketplaceJson(marketplace.local_path)
    name = meta.name || name
    description = meta.description
    owner = meta.owner
  } catch { /* use defaults */ }

  db.prepare(`UPDATE marketplaces SET name=?, description=?, owner=?, status='ready', git_commit_sha=?, last_updated=? WHERE id=?`)
    .run(name, description, owner, gitSha, now(), marketplace_id)

  // Delete existing plugins (re-sync)
  db.prepare(`DELETE FROM plugins WHERE marketplace_id=?`).run(marketplace_id)

  for (const p of plugins) {
    let pluginMeta = { version: null, author: null, author_url: null, description: null, keywords: null, homepage: null, license: null } as any
    try {
      pluginMeta = await readPluginJson(p.local_path)
    } catch { /* use defaults */ }

    const status = p.git_commit_sha !== null || p.source_type === 'local' ? 'ready' : 'error'
    db.prepare(`INSERT INTO plugins (id, marketplace_id, name, version, author, author_url, description, keywords, homepage, license, source_type, source_url, local_path, status, git_commit_sha, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuid(), marketplace_id, p.name,
      pluginMeta.version, pluginMeta.author, pluginMeta.author_url,
      pluginMeta.description, pluginMeta.keywords, pluginMeta.homepage, pluginMeta.license,
      p.source_type, p.source_url, p.local_path, status, p.git_commit_sha, now()
    )
  }
}

export function deleteMarketplace(db: Db, id: string, reposDir: string): boolean {
  const row = db.prepare(`SELECT local_path FROM marketplaces WHERE id=?`).get(id) as { local_path: string } | undefined
  if (!row) return false
  db.prepare(`DELETE FROM marketplaces WHERE id=?`).run(id)
  const pluginDir = join(reposDir, 'plugins', id)
  if (existsSync(row.local_path)) rm(row.local_path, { recursive: true, force: true }).catch(() => {})
  if (existsSync(pluginDir)) rm(pluginDir, { recursive: true, force: true }).catch(() => {})
  return true
}

export function listMarketplaces(db: Db) {
  return db.prepare(`
    SELECT m.*, COUNT(p.id) as plugin_count
    FROM marketplaces m
    LEFT JOIN plugins p ON p.marketplace_id = m.id
    GROUP BY m.id
    ORDER BY m.created_at DESC
  `).all()
}

export function getMarketplacePlugins(db: Db, marketplace_id: string) {
  return db.prepare(`SELECT * FROM plugins WHERE marketplace_id=? ORDER BY name`).all(marketplace_id)
}
```

- [ ] **Step 4: Create server/index.ts (Express app factory)**

Create `server/index.ts`:

```typescript
import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createDb } from './db.js'
import { marketplacesRouter } from './routes/marketplaces.js'
import { pluginsRouter } from './routes/plugins.js'
import { tasksRouter } from './routes/tasks.js'
import { exportsRouter } from './routes/exports.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const REPOS_DIR = join(process.cwd(), 'data', 'repos')
export const EXPORTS_DIR = join(process.cwd(), 'data', 'exports')

export function createApp(dbPath = join(process.cwd(), 'data', 'db.sqlite')) {
  const db = createDb(dbPath)
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.use('/api/marketplaces', marketplacesRouter(db))
  app.use('/api/plugins', pluginsRouter(db))
  app.use('/api/tasks', tasksRouter(db))
  app.use('/api/exports', exportsRouter(db))

  // Serve built client in production
  const clientDist = join(__dirname, '..', 'client')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'))
  })

  return app
}

// Start server when run directly
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const app = createApp()
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}
```

- [ ] **Step 5: Create server/routes/marketplaces.ts**

Create `server/routes/marketplaces.ts`:

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'
import {
  addMarketplace,
  deleteMarketplace,
  listMarketplaces,
  getMarketplacePlugins,
} from '../services/marketplace-service.js'
import { REPOS_DIR } from '../index.js'

export function marketplacesRouter(db: Db) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listMarketplaces(db))
  })

  router.post('/', (req, res) => {
    const { source_url } = req.body
    if (!source_url || typeof source_url !== 'string') {
      return res.status(400).json({ error: 'source_url is required' })
    }
    const result = addMarketplace(db, source_url, REPOS_DIR)
    res.status(202).json(result)
  })

  router.delete('/:id', (req, res) => {
    const deleted = deleteMarketplace(db, req.params.id, REPOS_DIR)
    if (!deleted) return res.status(404).json({ error: 'Marketplace not found' })
    res.status(204).send()
  })

  router.post('/:id/refresh', (req, res) => {
    const marketplace = db.prepare(`SELECT * FROM marketplaces WHERE id=?`).get(req.params.id) as any
    if (!marketplace) return res.status(404).json({ error: 'Marketplace not found' })
    const result = addMarketplace(db, marketplace.source_url, REPOS_DIR)
    res.status(202).json(result)
  })

  router.get('/:id/plugins', (req, res) => {
    const plugins = getMarketplacePlugins(db, req.params.id)
    res.json(plugins)
  })

  return router
}
```

- [ ] **Step 6: Create stub routes for plugins, tasks, exports (to satisfy imports)**

Create `server/routes/plugins.ts`:

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'

export function pluginsRouter(db: Db) {
  const router = Router()
  router.get('/:id', (req, res) => {
    const plugin = db.prepare(`SELECT * FROM plugins WHERE id=?`).get(req.params.id)
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' })
    res.json(plugin)
  })
  return router
}
```

Create `server/routes/tasks.ts`:

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'

export function tasksRouter(db: Db) {
  const router = Router()
  router.get('/', (_req, res) => {
    const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all()
    res.json(tasks)
  })
  // SSE endpoint added in Task 6
  return router
}
```

Create `server/routes/exports.ts`:

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'

export function exportsRouter(db: Db) {
  const router = Router()
  router.get('/', (_req, res) => {
    res.json(db.prepare(`SELECT * FROM exports ORDER BY created_at DESC`).all())
  })
  return router
}
```

- [ ] **Step 7: Run marketplace route tests**

```bash
npm test -- tests/routes/marketplaces.test.ts
```

Expected: PASS (4 tests — the POST clone test only creates the record, doesn't actually clone)

- [ ] **Step 8: Commit**

```bash
git add server/ tests/routes/marketplaces.test.ts
git commit -m "feat: marketplace service, routes, and Express app factory"
```

---

## Task 6: SSE Task Progress

**Files:**
- Modify: `server/routes/tasks.ts`
- Create: `tests/routes/tasks.test.ts`

SSE sends `data: <json>\n\n` events to the client. Each event is a task progress update. The endpoint polls the DB every 500ms and closes when the task reaches `completed` or `failed`.

- [ ] **Step 1: Write failing SSE test**

Create `tests/routes/tasks.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import type { Express } from 'express'
import { rm } from 'fs/promises'
import { join } from 'path'
import type { Db } from '../../server/db.js'
import { createDb } from '../../server/db.js'

const TEST_DB = join(process.cwd(), 'data', 'test-tasks.sqlite')
let app: Express
let db: Db

beforeEach(() => {
  app = createApp(TEST_DB)
  db = createDb(TEST_DB)
})

afterEach(async () => {
  db.close()
  await rm(TEST_DB, { force: true })
})

describe('GET /api/tasks', () => {
  it('returns empty array when no tasks', async () => {
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('GET /api/tasks/:id/events', () => {
  it('returns 404 for unknown task id', async () => {
    const res = await request(app).get('/api/tasks/nonexistent/events')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify 404 case fails**

```bash
npm test -- tests/routes/tasks.test.ts
```

Expected: the `/events` 404 test fails (stub router has no `:id/events` route)

- [ ] **Step 3: Update server/routes/tasks.ts with SSE**

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'

export function tasksRouter(db: Db) {
  const router = Router()

  router.get('/', (_req, res) => {
    const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all()
    res.json(tasks)
  })

  router.get('/:id/events', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as any
    if (!task) return res.status(404).json({ error: 'Task not found' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    // Send current state immediately
    const current = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as any
    send(current)

    if (current.status === 'completed' || current.status === 'failed') {
      res.end()
      return
    }

    const interval = setInterval(() => {
      const updated = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as any
      if (!updated) { clearInterval(interval); res.end(); return }
      send(updated)
      if (updated.status === 'completed' || updated.status === 'failed') {
        clearInterval(interval)
        res.end()
      }
    }, 500)

    req.on('close', () => clearInterval(interval))
  })

  return router
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/routes/tasks.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/routes/tasks.ts tests/routes/tasks.test.ts
git commit -m "feat: SSE task progress endpoint"
```

---

## Task 7: Export Service

**Files:**
- Create: `server/services/export-service.ts`
- Create: `server/workers/export-worker.ts`
- Modify: `server/routes/exports.ts`
- Create: `tests/export-service.test.ts`

- [ ] **Step 1: Write failing export service test**

Create `tests/export-service.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildExportStructure } from '../server/services/export-service.js'
import { mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'

const TMP = join(process.cwd(), 'data', 'test-export-fixtures')

beforeAll(() => {
  // Fake marketplace with one local plugin and one external plugin (already cloned)
  mkdirSync(join(TMP, 'market-a', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'market-a', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'market-a',
      description: 'Test',
      owner: { name: 'Test' },
      plugins: [
        { name: 'plugin-local', source: './plugins/plugin-local' },
        { name: 'plugin-ext', source: { source: 'github', repo: 'owner/plugin-ext' } },
      ],
    })
  )
  mkdirSync(join(TMP, 'market-a', 'plugins', 'plugin-local', '.claude-plugin'), { recursive: true })
  writeFileSync(join(TMP, 'market-a', 'plugins', 'plugin-local', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'plugin-local', version: '1.0.0' }))

  mkdirSync(join(TMP, 'ext', 'plugin-ext', '.claude-plugin'), { recursive: true })
  writeFileSync(join(TMP, 'ext', 'plugin-ext', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'plugin-ext', version: '2.0.0' }))
})

afterAll(() => rm(TMP, { recursive: true, force: true }))

describe('buildExportStructure', () => {
  it('returns correct file copy pairs and rewritten marketplace.json', async () => {
    const result = await buildExportStructure({
      marketplaceLocalPath: join(TMP, 'market-a'),
      marketplaceName: 'market-a',
      selectedPlugins: [
        { name: 'plugin-local', source_type: 'local', local_path: join(TMP, 'market-a', 'plugins', 'plugin-local') },
        { name: 'plugin-ext', source_type: 'external', local_path: join(TMP, 'ext', 'plugin-ext') },
      ],
    })

    expect(result.marketplaceJson.plugins).toHaveLength(2)
    // All sources should be local relative paths
    expect(result.marketplaceJson.plugins[0].source).toBe('./plugins/plugin-local')
    expect(result.marketplaceJson.plugins[1].source).toBe('./plugins/plugin-ext')

    // Should have copy entries for each plugin
    expect(result.copyEntries.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/export-service.test.ts
```

Expected: FAIL with "Cannot find module '../server/services/export-service.js'"

- [ ] **Step 3: Create export-service.ts**

Create `server/services/export-service.ts`:

```typescript
import { readFile, readdir, stat, copyFile, mkdir, writeFile } from 'fs/promises'
import { join, relative, dirname } from 'path'
import archiver from 'archiver'
import { createWriteStream, existsSync } from 'fs'

export interface SelectedPlugin {
  name: string
  source_type: 'local' | 'external'
  local_path: string
}

export interface ExportMarketplaceInput {
  marketplaceLocalPath: string
  marketplaceName: string
  selectedPlugins: SelectedPlugin[]
}

export interface ExportStructureResult {
  marketplaceJson: any
  copyEntries: { src: string; destRelative: string }[]
}

export async function buildExportStructure(input: ExportMarketplaceInput): Promise<ExportStructureResult> {
  const { marketplaceLocalPath, marketplaceName, selectedPlugins } = input

  // Read original marketplace.json for non-plugin fields
  const rawMeta = await readFile(join(marketplaceLocalPath, '.claude-plugin', 'marketplace.json'), 'utf-8')
  const originalMeta = JSON.parse(rawMeta)

  // Rewrite plugins array to use local relative paths only
  const rewrittenPlugins = selectedPlugins.map(p => ({
    name: p.name,
    source: `./plugins/${p.name}`,
    description: originalMeta.plugins?.find((op: any) => op.name === p.name)?.description,
  }))

  const marketplaceJson = {
    ...originalMeta,
    plugins: rewrittenPlugins,
  }

  // Build copy entries: all files under each plugin's local_path
  const copyEntries: { src: string; destRelative: string }[] = []

  for (const plugin of selectedPlugins) {
    if (!existsSync(plugin.local_path)) continue
    const files = await collectFiles(plugin.local_path)
    for (const file of files) {
      const relFromPlugin = relative(plugin.local_path, file)
      copyEntries.push({
        src: file,
        destRelative: join(marketplaceName, 'plugins', plugin.name, relFromPlugin),
      })
    }
  }

  return { marketplaceJson, copyEntries }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}

export interface BuildZipInput {
  exportId: string
  exportName: string
  marketplaces: ExportMarketplaceInput[]
  exportsDir: string
  onProgress: (pct: number, msg: string) => void
}

export async function buildZip(input: BuildZipInput): Promise<{ zipPath: string; zipSize: number }> {
  const { exportId, exportName, marketplaces, exportsDir, onProgress } = input
  const zipPath = join(exportsDir, `${exportId}.zip`)

  onProgress(5, 'Preparing export structure')

  const results = await Promise.all(marketplaces.map(m => buildExportStructure(m)))

  onProgress(20, 'Generating install scripts')

  const marketplaceNames = marketplaces.map(m => m.marketplaceName)
  const scripts = generateInstallScripts(marketplaceNames)
  const readme = generateReadme(marketplaceNames, marketplaces)

  onProgress(30, 'Packaging files into zip')

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    const rootDir = exportName

    // Add install scripts and README
    archive.append(scripts.sh, { name: `${rootDir}/install.sh` })
    archive.append(scripts.bat, { name: `${rootDir}/install.bat` })
    archive.append(scripts.ps1, { name: `${rootDir}/install.ps1` })
    archive.append(readme, { name: `${rootDir}/README.md` })

    // Add marketplace.json files
    for (let i = 0; i < marketplaces.length; i++) {
      const m = marketplaces[i]
      const result = results[i]
      archive.append(JSON.stringify(result.marketplaceJson, null, 2), {
        name: `${rootDir}/${m.marketplaceName}/.claude-plugin/marketplace.json`,
      })

      for (const entry of result.copyEntries) {
        archive.file(entry.src, { name: `${rootDir}/${entry.destRelative}` })
      }
    }

    archive.finalize()
  })

  const { size } = await stat(zipPath)
  return { zipPath, zipSize: size }
}

function generateInstallScripts(marketplaceNames: string[]) {
  const bat = [
    '@echo off',
    'set DIR=%~dp0',
    'echo Run the following commands in Claude Code:',
    'echo.',
    ...marketplaceNames.map(n => `echo /plugin marketplace add %DIR%${n}`),
    'pause',
  ].join('\r\n')

  const ps1 = [
    '$dir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    'Write-Host "Run the following commands in Claude Code:"',
    'Write-Host ""',
    ...marketplaceNames.map(n => `Write-Host "/plugin marketplace add $dir\\${n}"`),
  ].join('\n')

  const sh = [
    '#!/bin/bash',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'echo "Run the following commands in Claude Code:"',
    'echo ""',
    ...marketplaceNames.map(n => `echo "/plugin marketplace add $DIR/${n}"`),
  ].join('\n')

  return { bat, ps1, sh }
}

function generateReadme(marketplaceNames: string[], marketplaces: ExportMarketplaceInput[]) {
  const lines = [
    '# Claude Code Plugin Marketplace - Offline Package',
    '',
    '## Contents',
    '',
    ...marketplaces.map(m =>
      `- **${m.marketplaceName}** — ${m.selectedPlugins.length} plugin(s): ${m.selectedPlugins.map(p => p.name).join(', ')}`
    ),
    '',
    '## Prerequisites',
    '',
    '- [Claude Code](https://claude.ai/code) installed',
    '',
    '## Installation',
    '',
    '1. Extract this zip to any directory',
    '2. Run the install script for your OS to get the commands:',
    '   - **Windows CMD:** `install.bat`',
    '   - **Windows PowerShell:** `powershell -ExecutionPolicy Bypass -File install.ps1`',
    '   - **Linux / macOS:** `bash install.sh`',
    '3. Copy each printed command and run it in Claude Code',
    '',
    '## Notes',
    '',
    'The scripts detect their own location automatically.',
    'You can extract this package to any path — the generated commands will reflect the correct absolute paths.',
  ]
  return lines.join('\n')
}
```

- [ ] **Step 4: Run export service test**

```bash
npm test -- tests/export-service.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Create export-worker.ts**

Create `server/workers/export-worker.ts`:

```typescript
import { workerData, parentPort } from 'worker_threads'
import { buildZip, type BuildZipInput } from '../services/export-service.js'

export type ExportWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; zipPath: string; zipSize: number }
  | { type: 'error'; message: string }

function post(msg: ExportWorkerMessage) {
  parentPort?.postMessage(msg)
}

async function run() {
  const input = workerData as BuildZipInput & { exportId: string; exportName: string }

  try {
    const { zipPath, zipSize } = await buildZip({
      ...input,
      onProgress: (pct, msg) => post({ type: 'progress', progress: pct, message: msg }),
    })
    post({ type: 'done', zipPath, zipSize })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

run()
```

- [ ] **Step 6: Update server/routes/exports.ts with full implementation**

```typescript
import { Router } from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import { EXPORTS_DIR, REPOS_DIR } from '../index.js'
import type { ExportWorkerMessage } from '../workers/export-worker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAX_EXPORTS = 20

function now() { return new Date().toISOString() }
function uuid() { return crypto.randomUUID() }

export function exportsRouter(db: Db) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(db.prepare(`SELECT * FROM exports ORDER BY created_at DESC`).all())
  })

  router.get('/:id', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id)
    if (!exp) return res.status(404).json({ error: 'Export not found' })
    res.json(exp)
  })

  router.post('/', (req, res) => {
    // selected_content: { [marketplaceId]: pluginId[] }
    const { name, selected_content } = req.body
    if (!selected_content || typeof selected_content !== 'object') {
      return res.status(400).json({ error: 'selected_content is required' })
    }

    // Enforce 20-record limit: delete oldest if needed
    const count = (db.prepare(`SELECT COUNT(*) as c FROM exports`).get() as any).c
    if (count >= MAX_EXPORTS) {
      const oldest = db.prepare(`SELECT id, zip_path FROM exports ORDER BY created_at ASC LIMIT 1`).get() as any
      if (oldest) {
        if (oldest.zip_path && existsSync(oldest.zip_path)) {
          rm(oldest.zip_path, { force: true }).catch(() => {})
        }
        db.prepare(`DELETE FROM exports WHERE id=?`).run(oldest.id)
      }
    }

    const exportId = uuid()
    const exportName = (name as string) || `export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`

    db.prepare(`INSERT INTO exports (id, name, status, progress, selected_content, created_at)
      VALUES (?, ?, 'packaging', 0, ?, ?)`
    ).run(exportId, exportName, JSON.stringify(selected_content), now())

    // Build marketplaces input for worker
    const marketplacesInput = Object.entries(selected_content as Record<string, string[]>).map(([mId, pluginIds]) => {
      const marketplace = db.prepare(`SELECT * FROM marketplaces WHERE id=?`).get(mId) as any
      const plugins = pluginIds.map(pid => db.prepare(`SELECT * FROM plugins WHERE id=?`).get(pid) as any).filter(Boolean)
      return {
        marketplaceLocalPath: marketplace.local_path,
        marketplaceName: marketplace.name,
        selectedPlugins: plugins.map((p: any) => ({
          name: p.name,
          source_type: p.source_type,
          local_path: p.local_path,
        })),
      }
    })

    const workerPath = join(__dirname, '..', 'workers', 'export-worker.js')
    const worker = new Worker(workerPath, {
      workerData: { exportId, exportName, marketplaces: marketplacesInput, exportsDir: EXPORTS_DIR },
    })

    worker.on('message', (msg: ExportWorkerMessage) => {
      if (msg.type === 'progress') {
        db.prepare(`UPDATE exports SET progress=?, message=? WHERE id=?`)
          .run(msg.progress, msg.message, exportId)
      } else if (msg.type === 'done') {
        db.prepare(`UPDATE exports SET status='ready', progress=100, zip_path=?, zip_size=?, completed_at=? WHERE id=?`)
          .run(msg.zipPath, msg.zipSize, now(), exportId)
      } else if (msg.type === 'error') {
        db.prepare(`UPDATE exports SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(msg.message, now(), exportId)
      }
    })

    worker.on('error', (err) => {
      db.prepare(`UPDATE exports SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run(err.message, now(), exportId)
    })

    res.status(202).json({ export_id: exportId })
  })

  router.get('/:id/events', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    const current = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    send(current)

    if (current.status !== 'packaging') { res.end(); return }

    const interval = setInterval(() => {
      const updated = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
      if (!updated) { clearInterval(interval); res.end(); return }
      send(updated)
      if (updated.status !== 'packaging') { clearInterval(interval); res.end() }
    }, 500)

    req.on('close', () => clearInterval(interval))
  })

  router.get('/:id/download', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })
    if (exp.status !== 'ready' || !exp.zip_path) {
      return res.status(409).json({ error: 'Export not ready' })
    }
    res.download(exp.zip_path, `${exp.name}.zip`)
  })

  router.delete('/:id', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })
    if (exp.zip_path && existsSync(exp.zip_path)) {
      rm(exp.zip_path, { force: true }).catch(() => {})
    }
    db.prepare(`DELETE FROM exports WHERE id=?`).run(req.params.id)
    res.status(204).send()
  })

  return router
}
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add server/services/export-service.ts server/workers/export-worker.ts server/routes/exports.ts tests/export-service.test.ts
git commit -m "feat: export service, export worker, and export routes"
```

---

## Task 8: React App Shell

**Files:**
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/api.ts`

- [ ] **Step 1: Create client/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CC Plugin Marketplace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create client/src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **Step 3: Create client/src/App.tsx**

```tsx
import { Routes, Route, NavLink } from 'react-router-dom'
import MarketplaceList from './pages/MarketplaceList'
import MarketplaceDetail from './pages/MarketplaceDetail'
import TaskList from './pages/TaskList'
import ExportNew from './pages/ExportNew'
import ExportList from './pages/ExportList'
import ExportDetail from './pages/ExportDetail'

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <nav style={{ borderBottom: '1px solid #e5e7eb', padding: '12px 0', display: 'flex', gap: 24, marginBottom: 24 }}>
        <strong style={{ marginRight: 16 }}>CC Plugin Marketplace</strong>
        <NavLink to="/" end style={navStyle}>Marketplaces</NavLink>
        <NavLink to="/tasks" style={navStyle}>Tasks</NavLink>
        <NavLink to="/export" style={navStyle}>Exports</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<MarketplaceList />} />
        <Route path="/marketplace/:id" element={<MarketplaceDetail />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/export" element={<ExportList />} />
        <Route path="/export/new" element={<ExportNew />} />
        <Route path="/export/:id" element={<ExportDetail />} />
      </Routes>
    </div>
  )
}

function navStyle({ isActive }: { isActive: boolean }) {
  return { color: isActive ? '#2563eb' : '#374151', textDecoration: 'none', fontWeight: isActive ? 600 : 400 }
}
```

- [ ] **Step 4: Create client/src/api.ts**

```typescript
const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  marketplaces: {
    list: () => req<any[]>('GET', '/marketplaces'),
    add: (source_url: string) => req<any>('POST', '/marketplaces', { source_url }),
    delete: (id: string) => req<void>('DELETE', `/marketplaces/${id}`),
    refresh: (id: string) => req<any>('POST', `/marketplaces/${id}/refresh`),
    plugins: (id: string) => req<any[]>('GET', `/marketplaces/${id}/plugins`),
  },
  plugins: {
    get: (id: string) => req<any>('GET', `/plugins/${id}`),
  },
  tasks: {
    list: () => req<any[]>('GET', '/tasks'),
    events: (id: string) => new EventSource(`/api/tasks/${id}/events`),
  },
  exports: {
    list: () => req<any[]>('GET', '/exports'),
    get: (id: string) => req<any>('GET', `/exports/${id}`),
    create: (name: string, selected_content: Record<string, string[]>) =>
      req<any>('POST', '/exports', { name, selected_content }),
    delete: (id: string) => req<void>('DELETE', `/exports/${id}`),
    events: (id: string) => new EventSource(`/api/exports/${id}/events`),
    downloadUrl: (id: string) => `/api/exports/${id}/download`,
  },
}
```

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```

Expected: Server on port 3001, Vite dev server on port 5173, no errors. Open http://localhost:5173 and see the nav bar.

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "feat: React app shell with routing and API client"
```

---

## Task 9: Shared UI Components

**Files:**
- Create: `client/src/components/StatusBadge.tsx`
- Create: `client/src/components/ProgressBar.tsx`
- Create: `client/src/components/MarketplaceCard.tsx`
- Create: `client/src/components/PluginCard.tsx`

- [ ] **Step 1: Create StatusBadge.tsx**

```tsx
type Status = 'pending' | 'cloning' | 'ready' | 'error' | 'running' | 'completed' | 'failed' | 'packaging'

const colors: Record<Status, { bg: string; text: string }> = {
  pending:   { bg: '#f3f4f6', text: '#6b7280' },
  cloning:   { bg: '#dbeafe', text: '#1d4ed8' },
  running:   { bg: '#dbeafe', text: '#1d4ed8' },
  packaging: { bg: '#dbeafe', text: '#1d4ed8' },
  ready:     { bg: '#dcfce7', text: '#15803d' },
  completed: { bg: '#dcfce7', text: '#15803d' },
  error:     { bg: '#fee2e2', text: '#dc2626' },
  failed:    { bg: '#fee2e2', text: '#dc2626' },
}

export function StatusBadge({ status }: { status: string }) {
  const color = colors[status as Status] ?? { bg: '#f3f4f6', text: '#6b7280' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      backgroundColor: color.bg, color: color.text,
    }}>
      {status}
    </span>
  )
}
```

- [ ] **Step 2: Create ProgressBar.tsx**

```tsx
export function ProgressBar({ value, message }: { value: number; message?: string | null }) {
  return (
    <div>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: '#2563eb',
          width: `${Math.min(100, Math.max(0, value))}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
      {message && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{message}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create MarketplaceCard.tsx**

```tsx
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from './StatusBadge'

interface Props {
  marketplace: any
  onDelete: (id: string) => void
  onRefresh: (id: string) => void
}

export function MarketplaceCard({ marketplace: m, onDelete, onRefresh }: Props) {
  const nav = useNavigate()
  return (
    <div
      onClick={() => nav(`/marketplace/${m.id}`)}
      style={{
        border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, cursor: 'pointer',
        background: '#fff', transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 16 }}>{m.name}</strong>
          {m.owner && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 13 }}>by {m.owner}</span>}
        </div>
        <StatusBadge status={m.status} />
      </div>
      {m.description && <p style={{ color: '#4b5563', fontSize: 14, margin: '8px 0 4px' }}>{m.description}</p>}
      <p style={{ color: '#9ca3af', fontSize: 12, margin: '4px 0' }}>{m.source_url}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{m.plugin_count ?? 0} plugins</span>
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onRefresh(m.id)} style={btnStyle('#dbeafe', '#1d4ed8')}>Refresh</button>
          <button onClick={() => onDelete(m.id)} style={btnStyle('#fee2e2', '#dc2626')}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(bg: string, color: string) {
  return { background: bg, color, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }
}
```

- [ ] **Step 4: Create PluginCard.tsx**

```tsx
import { StatusBadge } from './StatusBadge'

export function PluginCard({ plugin: p }: { plugin: any }) {
  const keywords: string[] = p.keywords ? JSON.parse(p.keywords) : []
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{p.name}</strong>
          {p.version && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 12 }}>v{p.version}</span>}
        </div>
        <StatusBadge status={p.status} />
      </div>
      {p.author && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0' }}>
          {p.author_url
            ? <a href={p.author_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{p.author}</a>
            : p.author}
        </p>
      )}
      {p.description && <p style={{ color: '#4b5563', fontSize: 14, margin: '8px 0' }}>{p.description}</p>}
      {keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {keywords.map((k: string) => (
            <span key={k} style={{ background: '#f3f4f6', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#374151' }}>{k}</span>
          ))}
        </div>
      )}
      {p.homepage && (
        <a href={p.homepage} target="_blank" rel="noreferrer"
           style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#2563eb' }}
           onClick={e => e.stopPropagation()}>
          Homepage →
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/
git commit -m "feat: shared UI components (StatusBadge, ProgressBar, MarketplaceCard, PluginCard)"
```

---

## Task 10: Marketplace Pages

**Files:**
- Create: `client/src/pages/MarketplaceList.tsx`
- Create: `client/src/pages/MarketplaceDetail.tsx`

- [ ] **Step 1: Create MarketplaceList.tsx**

```tsx
import { useState, useEffect } from 'react'
import { api } from '../api'
import { MarketplaceCard } from '../components/MarketplaceCard'

export default function MarketplaceList() {
  const [marketplaces, setMarketplaces] = useState<any[]>([])
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try { setMarketplaces(await api.marketplaces.list()) }
    catch (e: any) { setError(e.message) }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true); setError(null)
    try {
      await api.marketplaces.add(url.trim())
      setUrl('')
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setAdding(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this marketplace and all its data?')) return
    await api.marketplaces.delete(id)
    await load()
  }

  async function handleRefresh(id: string) {
    await api.marketplaces.refresh(id)
    await load()
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Marketplaces</h1>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          value={url} onChange={e => setUrl(e.target.value)}
          placeholder="GitHub URL or git URL (e.g. owner/repo or https://github.com/owner/repo.git)"
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <button type="submit" disabled={adding}
          style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {adding ? 'Adding…' : 'Add Marketplace'}
        </button>
      </form>

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>{error}</p>}

      {marketplaces.length === 0
        ? <p style={{ color: '#9ca3af' }}>No marketplaces yet. Add one above.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {marketplaces.map(m => (
              <MarketplaceCard key={m.id} marketplace={m} onDelete={handleDelete} onRefresh={handleRefresh} />
            ))}
          </div>
        )
      }
    </div>
  )
}
```

- [ ] **Step 2: Create MarketplaceDetail.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { PluginCard } from '../components/PluginCard'

export default function MarketplaceDetail() {
  const { id } = useParams<{ id: string }>()
  const [marketplace, setMarketplace] = useState<any>(null)
  const [plugins, setPlugins] = useState<any[]>([])

  useEffect(() => {
    if (!id) return
    api.marketplaces.list().then(list => setMarketplace(list.find((m: any) => m.id === id)))
    api.marketplaces.plugins(id).then(setPlugins)
  }, [id])

  if (!marketplace) return <p>Loading…</p>

  return (
    <div>
      <Link to="/" style={{ color: '#2563eb', fontSize: 14 }}>← Marketplaces</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '12px 0 4px' }}>{marketplace.name}</h1>
      {marketplace.owner && <p style={{ color: '#6b7280', marginBottom: 4 }}>by {marketplace.owner}</p>}
      {marketplace.description && <p style={{ color: '#4b5563', marginBottom: 8 }}>{marketplace.description}</p>}
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 24 }}>
        {marketplace.source_url} · commit {marketplace.git_commit_sha?.slice(0, 8) ?? 'unknown'}
        {marketplace.last_updated && ` · updated ${new Date(marketplace.last_updated).toLocaleDateString()}`}
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Plugins ({plugins.length})</h2>
      {plugins.length === 0
        ? <p style={{ color: '#9ca3af' }}>No plugins found.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {plugins.map(p => <PluginCard key={p.id} plugin={p} />)}
          </div>
        )
      }
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/MarketplaceList.tsx client/src/pages/MarketplaceDetail.tsx
git commit -m "feat: marketplace list and detail pages"
```

---

## Task 11: Tasks Page

**Files:**
- Create: `client/src/pages/TaskList.tsx`

- [ ] **Step 1: Create TaskList.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'

export default function TaskList() {
  const [tasks, setTasks] = useState<any[]>([])
  const sources = useRef<Map<string, EventSource>>(new Map())

  useEffect(() => {
    api.tasks.list().then(list => {
      setTasks(list)
      list.filter((t: any) => t.status === 'running').forEach(subscribeToTask)
    })
    return () => { sources.current.forEach(s => s.close()) }
  }, [])

  function subscribeToTask(task: any) {
    if (sources.current.has(task.id)) return
    const es = api.tasks.events(task.id)
    sources.current.set(task.id, es)
    es.onmessage = (e) => {
      const updated = JSON.parse(e.data)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
      if (updated.status !== 'running') { es.close(); sources.current.delete(task.id) }
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Download Tasks</h1>
      {tasks.length === 0
        ? <p style={{ color: '#9ca3af' }}>No tasks yet.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tasks.map(t => (
              <div key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{t.type.replace(/_/g, ' ')}</span>
                  <StatusBadge status={t.status} />
                </div>
                {t.status === 'running' && <ProgressBar value={t.progress} message={t.message} />}
                {t.status !== 'running' && t.message && (
                  <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{t.message}</p>
                )}
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
                  Started {new Date(t.created_at).toLocaleString()}
                  {t.completed_at && ` · Finished ${new Date(t.completed_at).toLocaleString()}`}
                </p>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/TaskList.tsx
git commit -m "feat: tasks page with real-time SSE progress"
```

---

## Task 12: Export Pages

**Files:**
- Create: `client/src/pages/ExportList.tsx`
- Create: `client/src/pages/ExportNew.tsx`
- Create: `client/src/pages/ExportDetail.tsx`

- [ ] **Step 1: Create ExportList.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'

export default function ExportList() {
  const [exports, setExports] = useState<any[]>([])
  const sources = useRef<Map<string, EventSource>>(new Map())
  const nav = useNavigate()

  useEffect(() => {
    load()
    return () => { sources.current.forEach(s => s.close()) }
  }, [])

  async function load() {
    const list = await api.exports.list()
    setExports(list)
    list.filter((e: any) => e.status === 'packaging').forEach(subscribeToExport)
  }

  function subscribeToExport(exp: any) {
    if (sources.current.has(exp.id)) return
    const es = api.exports.events(exp.id)
    sources.current.set(exp.id, es)
    es.onmessage = (e) => {
      const updated = JSON.parse(e.data)
      setExports(prev => prev.map(x => x.id === updated.id ? updated : x))
      if (updated.status !== 'packaging') { es.close(); sources.current.delete(exp.id) }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this export?')) return
    await api.exports.delete(id)
    setExports(prev => prev.filter(e => e.id !== id))
  }

  const selected = JSON.parse(localStorage.getItem('exportSelection') || '{}')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Exports</h1>
        <Link to="/export/new">
          <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            New Export
          </button>
        </Link>
      </div>

      {exports.length === 0
        ? <p style={{ color: '#9ca3af' }}>No exports yet. <Link to="/export/new" style={{ color: '#2563eb' }}>Create one</Link>.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exports.map(e => {
              const content = JSON.parse(e.selected_content || '{}')
              const marketplaceCount = Object.keys(content).length
              const pluginCount = Object.values(content).flat().length
              return (
                <div key={e.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{e.name}</strong>
                      <span style={{ marginLeft: 12, color: '#6b7280', fontSize: 13 }}>
                        {marketplaceCount} marketplace{marketplaceCount !== 1 ? 's' : ''}, {pluginCount} plugin{pluginCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <StatusBadge status={e.status} />
                  </div>

                  {e.status === 'packaging' && (
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar value={e.progress} message={e.message} />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                    {e.status === 'ready' && (
                      <>
                        <a href={api.exports.downloadUrl(e.id)}>
                          <button style={{ padding: '4px 12px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                            Download {e.zip_size ? `(${(e.zip_size / 1024 / 1024).toFixed(1)} MB)` : ''}
                          </button>
                        </a>
                        <Link to={`/export/${e.id}`} style={{ color: '#2563eb', fontSize: 13 }}>View Details</Link>
                      </>
                    )}
                    <button onClick={() => handleDelete(e.id)}
                      style={{ marginLeft: 'auto', padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      Delete
                    </button>
                  </div>

                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
                    Created {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}
```

- [ ] **Step 2: Create ExportNew.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function ExportNew() {
  const [marketplaces, setMarketplaces] = useState<any[]>([])
  const [plugins, setPlugins] = useState<Record<string, any[]>>({})
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    api.marketplaces.list().then(async list => {
      const readyList = list.filter((m: any) => m.status === 'ready')
      setMarketplaces(readyList)
      const pluginMap: Record<string, any[]> = {}
      for (const m of readyList) {
        pluginMap[m.id] = await api.marketplaces.plugins(m.id)
      }
      setPlugins(pluginMap)
    })
  }, [])

  function toggleMarketplace(mId: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[mId]) {
        delete next[mId]
      } else {
        next[mId] = new Set((plugins[mId] || []).map((p: any) => p.id))
      }
      return next
    })
  }

  function togglePlugin(mId: string, pId: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (!next[mId]) next[mId] = new Set()
      if (next[mId].has(pId)) next[mId].delete(pId)
      else next[mId].add(pId)
      if (next[mId].size === 0) delete next[mId]
      return next
    })
  }

  function totalPlugins() {
    return Object.values(selected).reduce((s, set) => s + set.size, 0)
  }

  async function handleSubmit() {
    setSubmitting(true)
    const content: Record<string, string[]> = {}
    for (const [mId, pSet] of Object.entries(selected)) {
      content[mId] = Array.from(pSet)
    }
    try {
      await api.exports.create(name, content)
      nav('/export')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>New Export</h1>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Export Name (optional)</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. team-plugins-2026-04"
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, width: 320 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Left: tree selector */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Select Plugins</h2>
          {marketplaces.length === 0
            ? <p style={{ color: '#9ca3af' }}>No ready marketplaces available.</p>
            : marketplaces.map(m => {
              const mPlugins = plugins[m.id] || []
              const mSelected = selected[m.id]
              const allChecked = mSelected?.size === mPlugins.length
              return (
                <div key={m.id} style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={!!mSelected && mSelected.size > 0}
                      ref={el => { if (el) el.indeterminate = !!mSelected && mSelected.size > 0 && !allChecked }}
                      onChange={() => toggleMarketplace(m.id)} />
                    {m.name} ({mPlugins.length} plugins)
                  </label>
                  <div style={{ marginTop: 8, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {mPlugins.map((p: any) => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={!!mSelected?.has(p.id)} onChange={() => togglePlugin(m.id, p.id)} />
                        {p.name}{p.version ? ` v${p.version}` : ''}
                        {p.description && <span style={{ color: '#9ca3af', fontSize: 12 }}>— {p.description.slice(0, 60)}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })
          }
        </div>

        {/* Right: summary */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#f9fafb', position: 'sticky', top: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Summary</h2>
            <p style={{ margin: '4px 0', fontSize: 14 }}>{Object.keys(selected).length} marketplace{Object.keys(selected).length !== 1 ? 's' : ''}</p>
            <p style={{ margin: '4px 0', fontSize: 14 }}>{totalPlugins()} plugin{totalPlugins() !== 1 ? 's' : ''}</p>
            <button
              onClick={handleSubmit}
              disabled={submitting || totalPlugins() === 0}
              style={{
                marginTop: 16, width: '100%', padding: '8px 0',
                background: totalPlugins() === 0 ? '#e5e7eb' : '#2563eb',
                color: totalPlugins() === 0 ? '#9ca3af' : '#fff',
                border: 'none', borderRadius: 6, cursor: totalPlugins() === 0 ? 'default' : 'pointer', fontWeight: 600,
              }}>
              {submitting ? 'Creating…' : 'Start Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ExportDetail.tsx**

```tsx
import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { PluginCard } from '../components/PluginCard'
import { StatusBadge } from '../components/StatusBadge'

export default function ExportDetail() {
  const { id } = useParams<{ id: string }>()
  const [exp, setExp] = useState<any>(null)
  const [plugins, setPlugins] = useState<any[]>([])

  useEffect(() => {
    if (!id) return
    api.exports.get(id).then(async (e) => {
      setExp(e)
      const content: Record<string, string[]> = JSON.parse(e.selected_content)
      const allPlugins: any[] = []
      for (const pluginIds of Object.values(content)) {
        for (const pid of pluginIds) {
          try { allPlugins.push(await api.plugins.get(pid)) } catch { /* skip deleted */ }
        }
      }
      setPlugins(allPlugins)
    })
  }, [id])

  if (!exp) return <p>Loading…</p>

  return (
    <div>
      <Link to="/export" style={{ color: '#2563eb', fontSize: 14 }}>← Exports</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '12px 0 4px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{exp.name}</h1>
        <StatusBadge status={exp.status} />
      </div>
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
        Created {new Date(exp.created_at).toLocaleString()}
        {exp.zip_size && ` · ${(exp.zip_size / 1024 / 1024).toFixed(1)} MB`}
      </p>
      {exp.status === 'ready' && (
        <a href={api.exports.downloadUrl(exp.id)} style={{ display: 'inline-block', marginBottom: 24 }}>
          <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Download Zip
          </button>
        </a>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Included Plugins ({plugins.length})
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {plugins.map(p => <PluginCard key={p.id} plugin={p} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/
git commit -m "feat: export list, new export, and export detail pages"
```

---

## Task 13: Production Build & Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Build the full app**

```bash
npm run build
```

Expected: `dist/server/` and `dist/client/` created with no TypeScript errors.

- [ ] **Step 2: Start the production server**

```bash
npm start
```

Expected: `Server running on http://localhost:3001`

- [ ] **Step 3: Smoke test in browser**

Open http://localhost:3001 and verify:
- Nav shows Marketplaces / Tasks / Exports links
- Marketplace list page loads (empty state shows)
- Navigating to `/tasks` and `/export` works without errors
- `/export/new` shows empty state message

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify production build passes"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Add marketplace by GitHub/git URL → Task 5
- ✅ Recursive clone of external plugins → Task 4 (clone-worker)
- ✅ SQLite metadata storage → Task 2
- ✅ Worker Threads for async operations → Tasks 4, 7
- ✅ SSE real-time progress for downloads → Task 6
- ✅ SSE real-time progress for exports → Task 7 (exports.ts)
- ✅ Marketplace list with card UI → Tasks 9, 10
- ✅ Plugin cards with name/version/author/description/keywords/homepage → Task 9
- ✅ Export: select marketplaces + plugin subsets → Task 12 (ExportNew)
- ✅ Export: async packaging with progress → Task 7
- ✅ Export: download button after packaging → Task 12 (ExportList, ExportDetail)
- ✅ Export detail page → Task 12 (ExportDetail)
- ✅ Max 20 export records → Task 7 (exports.ts)
- ✅ Export zip structure: per-marketplace dirs → Task 7 (export-service)
- ✅ Sources rewritten to local relative paths → Task 7 (buildExportStructure)
- ✅ install.sh / install.bat / install.ps1 → Task 7 (generateInstallScripts)
- ✅ README.md in export → Task 7 (generateReadme)
- ✅ Delete marketplace → Task 5
- ✅ Refresh marketplace → Task 5
- ✅ npm start (no Docker) → Task 1
