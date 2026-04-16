# Proxy Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings page with configurable HTTP/HTTPS/SOCKS proxy (toggle + URL) that applies to all git clone/pull/fetch operations.

**Architecture:** New `settings` key-value table in SQLite. Settings service reads/writes proxy config. REST endpoint `/api/settings/proxy` with URL validation. Task scheduler reads proxy config at worker spawn time and passes via `workerData`. Clone worker applies proxy via `simpleGit({ config: ['http.proxy=...', 'https.proxy=...'] })` so `-c` flags are injected per git invocation without touching global git config.

**Tech Stack:** Express, better-sqlite3, simple-git `{ config: [...] }` option, worker_threads, React, native `URL` for validation, vitest.

---

## File Structure

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `server/db.ts` | Schema | Modify: add `settings` table |
| `server/services/settings-service.ts` | Settings read/write + URL validation | Create |
| `server/routes/settings.ts` | REST endpoints | Create |
| `server/index.ts` | App wiring | Modify: mount settings router |
| `server/workers/clone-worker.ts` | Git clone | Modify: accept proxy, `makeGit` helper |
| `server/services/task-scheduler.ts` | Worker orchestration | Modify: pass proxy via workerData |
| `client/src/pages/Settings.tsx` | Settings UI | Create |
| `client/src/App.tsx` | Nav + routing | Modify: add Settings link + route |
| `client/src/api.ts` | API client | Modify: add `api.settings` |
| `tests/db.test.ts` | Schema tests | Modify: verify settings table |
| `tests/settings-service.test.ts` | Service tests | Create |
| `tests/routes/settings.test.ts` | Endpoint tests | Create |

---

### Task 1: Database Schema — `settings` Table

**Files:**
- Modify: `server/db.ts`
- Modify: `tests/db.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/db.test.ts` after existing tests:

```typescript
it('settings table exists with key/value/updated_at columns', () => {
  const cols = db.prepare(`PRAGMA table_info(settings)`).all() as { name: string; pk: number }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain('key')
  expect(colNames).toContain('value')
  expect(colNames).toContain('updated_at')
  // key is primary key
  const keyCol = cols.find(c => c.name === 'key')
  expect(keyCol?.pk).toBe(1)
})
```

Also update the first test that checks "creates all 4 tables" — it now should check 5 tables:

```typescript
it('creates all 5 tables', () => {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all() as { name: string }[]
  const names = tables.map(t => t.name)
  expect(names).toContain('marketplaces')
  expect(names).toContain('plugins')
  expect(names).toContain('tasks')
  expect(names).toContain('exports')
  expect(names).toContain('settings')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL (settings table not found)

- [ ] **Step 3: Add settings table**

In `server/db.ts`, inside the `db.exec(...)` block, after the `exports` table definition and before the closing backtick, add:

```sql

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: ALL pass

- [ ] **Step 5: Delete existing DB and commit**

```bash
rm -f data/db.sqlite*
git add server/db.ts tests/db.test.ts
git commit -m "feat: add settings table for proxy configuration"
```

---

### Task 2: Settings Service + URL Validation

**Files:**
- Create: `server/services/settings-service.ts`
- Create: `tests/settings-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/settings-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../server/db.js'
import {
  getSetting, setSetting,
  getProxyConfig, setProxyConfig,
  validateProxyUrl,
} from '../server/services/settings-service.js'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-settings-service.sqlite')
let db: Db

beforeEach(() => { db = createDb(TEST_DB) })
afterEach(async () => { db.close(); await rm(TEST_DB, { force: true }) })

describe('getSetting / setSetting', () => {
  it('returns null for missing key', () => {
    expect(getSetting(db, 'nope')).toBeNull()
  })

  it('round-trips a value', () => {
    setSetting(db, 'proxy.url', 'http://a:8080')
    expect(getSetting(db, 'proxy.url')).toBe('http://a:8080')
  })

  it('overwrites on repeat set', () => {
    setSetting(db, 'proxy.url', 'http://a:8080')
    setSetting(db, 'proxy.url', 'http://b:9090')
    expect(getSetting(db, 'proxy.url')).toBe('http://b:9090')
  })
})

describe('getProxyConfig', () => {
  it('returns default when unset', () => {
    expect(getProxyConfig(db)).toEqual({ enabled: false, url: '' })
  })

  it('returns stored config', () => {
    setSetting(db, 'proxy.enabled', 'true')
    setSetting(db, 'proxy.url', 'http://proxy:8080')
    expect(getProxyConfig(db)).toEqual({ enabled: true, url: 'http://proxy:8080' })
  })

  it('treats non-true values as false', () => {
    setSetting(db, 'proxy.enabled', 'false')
    setSetting(db, 'proxy.url', 'http://proxy:8080')
    expect(getProxyConfig(db).enabled).toBe(false)
  })
})

describe('setProxyConfig', () => {
  it('writes both keys', () => {
    setProxyConfig(db, { enabled: true, url: 'http://x:1' })
    expect(getSetting(db, 'proxy.enabled')).toBe('true')
    expect(getSetting(db, 'proxy.url')).toBe('http://x:1')
  })
})

describe('validateProxyUrl', () => {
  it('accepts http://', () => {
    expect(validateProxyUrl('http://proxy.corp:8080')).toBeNull()
  })
  it('accepts https://', () => {
    expect(validateProxyUrl('https://proxy.corp:8443')).toBeNull()
  })
  it('accepts socks5://', () => {
    expect(validateProxyUrl('socks5://127.0.0.1:1080')).toBeNull()
  })
  it('accepts socks5h://', () => {
    expect(validateProxyUrl('socks5h://127.0.0.1:1080')).toBeNull()
  })
  it('accepts URL with user:pass auth', () => {
    expect(validateProxyUrl('http://user:pass@proxy.corp:8080')).toBeNull()
  })
  it('rejects non-URL string', () => {
    expect(validateProxyUrl('not a url')).toMatch(/Invalid URL/i)
  })
  it('rejects unsupported protocol', () => {
    expect(validateProxyUrl('ftp://proxy.corp:8080')).toMatch(/Unsupported protocol/i)
  })
  it('rejects URL without host', () => {
    // Note: 'http://' with no host throws at URL parse time, so it ends up under "Invalid URL"
    const msg = validateProxyUrl('http://')
    expect(msg).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings-service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement settings-service.ts**

Create `server/services/settings-service.ts`:

```typescript
import type { Db } from '../db.js'

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

function now() { return new Date().toISOString() }

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, value, now())
}

export function getProxyConfig(db: Db): ProxyConfig {
  const enabled = getSetting(db, 'proxy.enabled') === 'true'
  const url = getSetting(db, 'proxy.url') ?? ''
  return { enabled, url }
}

export function setProxyConfig(db: Db, config: ProxyConfig): void {
  setSetting(db, 'proxy.enabled', config.enabled ? 'true' : 'false')
  setSetting(db, 'proxy.url', config.url)
}

export function validateProxyUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return `Unsupported protocol "${parsed.protocol}". Use http://, https://, socks5://, or socks5h://`
  }
  if (!parsed.hostname) return 'Proxy URL must include a host'
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings-service.test.ts`
Expected: ALL pass

- [ ] **Step 5: Commit**

```bash
git add server/services/settings-service.ts tests/settings-service.test.ts
git commit -m "feat: add settings service with proxy config and URL validation"
```

---

### Task 3: Settings API Routes

**Files:**
- Create: `server/routes/settings.ts`
- Modify: `server/index.ts`
- Create: `tests/routes/settings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/routes/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import { createDb, type Db } from '../../server/db.js'
import type { Express } from 'express'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-settings-routes.sqlite')
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

describe('GET /api/settings/proxy', () => {
  it('returns default when unset', async () => {
    const res = await request(app).get('/api/settings/proxy')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: false, url: '' })
  })

  it('returns stored config', async () => {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('proxy.enabled', 'true', ?)`).run(new Date().toISOString())
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('proxy.url', 'http://proxy.corp:8080', ?)`).run(new Date().toISOString())

    const res = await request(app).get('/api/settings/proxy')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, url: 'http://proxy.corp:8080' })
  })
})

describe('PUT /api/settings/proxy', () => {
  it('saves enabled=false with empty url', async () => {
    const res = await request(app).put('/api/settings/proxy').send({ enabled: false, url: '' })
    expect(res.status).toBe(204)

    const get = await request(app).get('/api/settings/proxy')
    expect(get.body).toEqual({ enabled: false, url: '' })
  })

  it('saves enabled=true with valid URL', async () => {
    const res = await request(app).put('/api/settings/proxy').send({ enabled: true, url: 'http://proxy.corp:8080' })
    expect(res.status).toBe(204)

    const get = await request(app).get('/api/settings/proxy')
    expect(get.body).toEqual({ enabled: true, url: 'http://proxy.corp:8080' })
  })

  it('rejects enabled=true with invalid URL', async () => {
    const res = await request(app).put('/api/settings/proxy').send({ enabled: true, url: 'not a url' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('rejects enabled=true with unsupported protocol', async () => {
    const res = await request(app).put('/api/settings/proxy').send({ enabled: true, url: 'ftp://proxy:21' })
    expect(res.status).toBe(400)
  })

  it('allows enabled=false with any url string (draft preserved)', async () => {
    const res = await request(app).put('/api/settings/proxy').send({ enabled: false, url: 'not a url' })
    expect(res.status).toBe(204)
  })

  it('rejects missing fields', async () => {
    const res = await request(app).put('/api/settings/proxy').send({})
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/routes/settings.test.ts`
Expected: FAIL (route not mounted, 404s)

- [ ] **Step 3: Implement the router**

Create `server/routes/settings.ts`:

```typescript
import { Router } from 'express'
import type { Db } from '../db.js'
import { getProxyConfig, setProxyConfig, validateProxyUrl } from '../services/settings-service.js'

export function settingsRouter(db: Db) {
  const router = Router()

  router.get('/proxy', (_req, res) => {
    res.json(getProxyConfig(db))
  })

  router.put('/proxy', (req, res) => {
    const { enabled, url } = req.body ?? {}
    if (typeof enabled !== 'boolean' || typeof url !== 'string') {
      return res.status(400).json({ error: 'Request body must include { enabled: boolean, url: string }' })
    }

    // Validate only when enabled=true and url is non-empty
    if (enabled && url.trim().length > 0) {
      const err = validateProxyUrl(url)
      if (err) return res.status(400).json({ error: err })
    }

    setProxyConfig(db, { enabled, url })
    res.status(204).send()
  })

  return router
}
```

- [ ] **Step 4: Mount router in index.ts**

In `server/index.ts`, add the import near the other route imports:

```typescript
import { settingsRouter } from './routes/settings.js'
```

Then add the `app.use` call after the `exports` router mount:

```typescript
  app.use('/api/settings', settingsRouter(db))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/routes/settings.test.ts`
Expected: ALL pass

- [ ] **Step 6: Commit**

```bash
git add server/routes/settings.ts server/index.ts tests/routes/settings.test.ts
git commit -m "feat: add /api/settings/proxy GET and PUT endpoints"
```

---

### Task 4: Clone Worker — Proxy Support via `makeGit`

**Files:**
- Modify: `server/workers/clone-worker.ts`

- [ ] **Step 1: Add proxy to CloneWorkerInput**

In `server/workers/clone-worker.ts`, update the `CloneWorkerInput` interface to add the `proxy` field:

```typescript
export interface CloneWorkerInput {
  mode: 'marketplace' | 'plugin'
  taskId: string
  marketplaceId?: string
  pluginId?: string
  sourceUrl: string
  branch?: string
  reposDir?: string
  pluginDir?: string
  pluginName?: string
  sourceFormat?: string
  subdirPath?: string
  proxy?: { enabled: boolean; url: string }
}
```

- [ ] **Step 2: Add makeGit helper**

In `server/workers/clone-worker.ts`, add this helper right after the `post` function:

```typescript
function makeGit(dir?: string) {
  const { proxy } = workerData as CloneWorkerInput
  const configOpts = proxy?.enabled && proxy?.url
    ? { config: [`http.proxy=${proxy.url}`, `https.proxy=${proxy.url}`] }
    : undefined
  if (dir) {
    return configOpts ? simpleGit(dir, configOpts) : simpleGit(dir)
  }
  return configOpts ? simpleGit(configOpts) : simpleGit()
}
```

- [ ] **Step 3: Replace all simpleGit() calls with makeGit()**

In `server/workers/clone-worker.ts`, replace each of the 8 `simpleGit(...)` occurrences. Explicitly:

Line ~89 inside `getHeadSha`:
```typescript
    const git = makeGit(repoPath)
```

Line ~100 inside `isValidGitRepo`:
```typescript
    const git = makeGit(dir)
```

Line ~108 inside `cloneOrPull` (first branch — existing repo):
```typescript
    const git = makeGit(targetDir)
```

Line ~132 inside `cloneOrPull` (second branch — fresh clone):
```typescript
    const git = makeGit()
```

Line ~159 inside `cloneSubdir` (first branch):
```typescript
    const git = makeGit(targetDir)
```

Line ~186 inside `cloneSubdir` (second branch):
```typescript
  const git = makeGit()
```

Line ~204 inside `cloneSubdir` (sparse-checkout configuration):
```typescript
  const repoGit = makeGit(targetDir)
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL pass (no tests changed, but this verifies nothing regressed)

- [ ] **Step 5: Commit**

```bash
git add server/workers/clone-worker.ts
git commit -m "feat: clone worker accepts proxy config via workerData"
```

---

### Task 5: Task Scheduler — Propagate Proxy to Workers

**Files:**
- Modify: `server/services/task-scheduler.ts`

- [ ] **Step 1: Add import for getProxyConfig**

In `server/services/task-scheduler.ts`, add near the other service imports at the top:

```typescript
import { getProxyConfig } from './settings-service.js'
```

- [ ] **Step 2: Read proxy in startWorker and pass via workerData**

In `server/services/task-scheduler.ts`, inside `startWorker`, add a line right before the `if (task.type === 'clone_marketplace') {` block (around line 236) to read the proxy config:

```typescript
    const proxy = getProxyConfig(this.db)

    // Build workerData based on task type
    let workerDataPayload: Record<string, any>

    if (task.type === 'clone_marketplace') {
      workerDataPayload = {
        mode: 'marketplace',
        taskId: task.id,
        marketplaceId: task.marketplace_id,
        sourceUrl: task.repo_url,
        branch: task.branch,
        reposDir: this.reposDir,
        proxy,
      }
    } else {
      // clone_plugin
      let pluginDir: string
      if (task.parent_task_id && task.marketplace_id && task.plugin_name) {
        pluginDir = join(this.reposDir, 'plugins', task.marketplace_id, task.plugin_name)
      } else {
        const plugin = this.db.prepare(`SELECT local_path FROM plugins WHERE id=?`).get(task.plugin_id) as { local_path: string } | undefined
        pluginDir = plugin?.local_path ?? join(this.reposDir, 'plugins', task.plugin_id ?? 'unknown')
      }
      workerDataPayload = {
        mode: 'plugin',
        taskId: task.id,
        pluginId: task.plugin_id,
        sourceUrl: task.repo_url,
        branch: task.branch,
        pluginDir,
        pluginName: task.plugin_name,
        sourceFormat: task.source_format,
        subdirPath: task.subdir_path,
        proxy,
      }
    }
```

Only two changes: add `const proxy = getProxyConfig(this.db)` at the top of the function's workerData construction, and add `proxy,` to both `workerDataPayload` objects.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL pass

- [ ] **Step 4: Commit**

```bash
git add server/services/task-scheduler.ts
git commit -m "feat: task scheduler reads proxy config and passes to workers"
```

---

### Task 6: Frontend API Client

**Files:**
- Modify: `client/src/api.ts`

- [ ] **Step 1: Add settings API methods**

In `client/src/api.ts`, add a new `settings` section inside the `api` object, after `exports`:

```typescript
  settings: {
    getProxy: () => req<{ enabled: boolean; url: string }>('GET', '/settings/proxy'),
    updateProxy: (config: { enabled: boolean; url: string }) =>
      req<void>('PUT', '/settings/proxy', config),
  },
```

Final file contents (context):

```typescript
export const api = {
  marketplaces: { /* ... */ },
  plugins: { /* ... */ },
  tasks: { /* ... */ },
  exports: { /* ... */ },
  settings: {
    getProxy: () => req<{ enabled: boolean; url: string }>('GET', '/settings/proxy'),
    updateProxy: (config: { enabled: boolean; url: string }) =>
      req<void>('PUT', '/settings/proxy', config),
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api.ts
git commit -m "feat: add settings API client methods"
```

---

### Task 7: Frontend Settings Page

**Files:**
- Create: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Create the Settings page**

Create `client/src/pages/Settings.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { api } from '../api'
import { useToast } from '../components/Toast'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

function validateProxyUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return `Unsupported protocol "${parsed.protocol}". Use http://, https://, socks5://, or socks5h://`
  }
  if (!parsed.hostname) return 'Proxy URL must include a host'
  return null
}

export default function Settings() {
  const { showToast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.settings.getProxy()
      .then(cfg => { setEnabled(cfg.enabled); setUrl(cfg.url) })
      .catch((e: any) => showToast('error', e.message ?? 'Failed to load settings'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (enabled && url.trim().length > 0) {
      const err = validateProxyUrl(url)
      if (err) {
        showToast('error', err)
        return
      }
    }
    setSaving(true)
    try {
      await api.settings.updateProxy({ enabled, url })
      showToast('success', 'Proxy settings saved')
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: '#fff', maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>Proxy</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
          Configure an HTTP, HTTPS, or SOCKS proxy for all git clone, fetch, and pull operations.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Enable proxy</span>
        </label>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: enabled ? '#111827' : '#9ca3af' }}>
            Proxy URL
          </label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={!enabled}
            placeholder="http://proxy.example.com:8080"
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: '1px solid #d1d5db', fontSize: 14,
              background: enabled ? '#fff' : '#f3f4f6',
              color: enabled ? '#111827' : '#9ca3af',
            }}
          />
          <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0' }}>
            Supports <code>http://</code>, <code>https://</code>, <code>socks5://</code>, <code>socks5h://</code>.
            Authentication can be included inline, e.g. <code>http://user:pass@proxy:8080</code>.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 16px', background: '#2563eb', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/Settings.tsx
git commit -m "feat: add Settings page for proxy configuration"
```

---

### Task 8: Frontend Nav + Route

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Add import, nav link, and route**

In `client/src/App.tsx`, add the import after the other page imports:

```typescript
import Settings from './pages/Settings'
```

Add the nav link after the Exports NavLink (inside `<nav>`):

```typescript
        <NavLink to="/settings" style={navStyle}>Settings</NavLink>
```

Add the route inside `<Routes>` after the export routes:

```typescript
        <Route path="/settings" element={<Settings />} />
```

Final structure of the changes (context):

```typescript
import { Routes, Route, NavLink } from 'react-router-dom'
import MarketplaceList from './pages/MarketplaceList'
import MarketplaceDetail from './pages/MarketplaceDetail'
import TaskList from './pages/TaskList'
import ExportNew from './pages/ExportNew'
import ExportList from './pages/ExportList'
import ExportDetail from './pages/ExportDetail'
import Settings from './pages/Settings'
import { ToastProvider } from './components/Toast'

export default function App() {
  return (
    <ToastProvider>
    <div style={{ fontFamily: 'sans-serif', maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
      <nav style={{ borderBottom: '1px solid #e5e7eb', padding: '12px 0', display: 'flex', gap: 24, marginBottom: 24 }}>
        <strong style={{ marginRight: 16 }}>CC Plugin Marketplace</strong>
        <NavLink to="/" end style={navStyle}>Marketplaces</NavLink>
        <NavLink to="/tasks" style={navStyle}>Tasks</NavLink>
        <NavLink to="/export" style={navStyle}>Exports</NavLink>
        <NavLink to="/settings" style={navStyle}>Settings</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<MarketplaceList />} />
        <Route path="/marketplace/:id" element={<MarketplaceDetail />} />
        <Route path="/tasks" element={<TaskList />} />
        <Route path="/export" element={<ExportList />} />
        <Route path="/export/new" element={<ExportNew />} />
        <Route path="/export/:id" element={<ExportDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
    </ToastProvider>
  )
}

function navStyle({ isActive }: { isActive: boolean }) {
  return { color: isActive ? '#2563eb' : '#374151', textDecoration: 'none', fontWeight: isActive ? 600 : 400 }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add Settings nav link and route"
```

---

### Task 9: Integration Verification

**Files:** None — manual verification only.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start server and verify**

```bash
rm -f data/db.sqlite*
npm run dev
```

Manual checks:
- Navigate to `http://localhost:5173/settings` (Vite dev) — Settings page loads
- Toggle is off by default, URL input is disabled and empty
- Check toggle → URL input becomes enabled
- Type `http://proxy.example.com:8080` → click Save → success toast
- Refresh page → values persist (enabled=true, URL populated)
- Uncheck toggle → input becomes disabled but URL value is preserved
- Enter an invalid URL (`not a url`) with toggle on → click Save → error toast, not persisted
- Add a marketplace → verify the clone task works; if the proxy URL is unreachable, the task fails with a clear git error in `task.message`

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes for proxy settings"
```
