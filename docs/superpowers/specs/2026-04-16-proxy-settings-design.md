# Proxy Settings Design

## Goal

Add a Settings page with a configurable proxy (toggle + URL) that applies to all git clone/pull/fetch operations performed by the clone-worker. The proxy is injected per git invocation via `-c http.proxy=... -c https.proxy=...`, without modifying the system's global git configuration.

## Architecture

Three layers:

1. **Persistence** — A new generic `settings` key-value table in SQLite, seeded for future extensibility.
2. **Propagation** — The TaskScheduler reads proxy config when spawning each clone worker and passes it via `workerData`. The worker applies the config to every `simpleGit()` instance.
3. **UI** — A new `/settings` page in the React SPA with a toggle + URL input and save action. The toggle only controls whether the saved URL is applied; disabling does not erase the URL.

## Tech Stack

Express, better-sqlite3, simple-git (`{ config: [...] }` option), worker_threads, React, vitest.

---

## 1. Database Schema

New table in `server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
```

Stored proxy keys:

| Key | Type | Values |
|-----|------|--------|
| `proxy.enabled` | text | `'true'` or `'false'` |
| `proxy.url` | text | Proxy URL string (e.g., `http://user:pass@proxy.corp:8080`) |

Both entries are created on first access if missing; defaults: `proxy.enabled='false'`, `proxy.url=''`.

## 2. Backend

### 2.1 `server/services/settings-service.ts` (new)

Generic key-value helpers + typed proxy accessor:

```typescript
export interface ProxyConfig {
  enabled: boolean
  url: string
}

export function getSetting(db: Db, key: string): string | null
export function setSetting(db: Db, key: string, value: string): void
export function getProxyConfig(db: Db): ProxyConfig
export function setProxyConfig(db: Db, config: ProxyConfig): void
```

`getProxyConfig` returns `{ enabled: false, url: '' }` if keys missing. `setProxyConfig` writes both keys atomically.

### 2.2 `server/routes/settings.ts` (new)

```
GET /api/settings/proxy  → { enabled, url }
PUT /api/settings/proxy  → body { enabled, url } → 204 or 400 (invalid URL)
```

`PUT` validates URL when `enabled=true` and `url` is non-empty:
- Parses with Node `URL` constructor — rejects if it throws.
- Allowed protocols: `http:`, `https:`, `socks5:`, `socks5h:`.
- When `enabled=false`, URL is saved as-is without format validation (users may keep a draft).

### 2.3 `server/workers/clone-worker.ts` (modify)

Extend `CloneWorkerInput`:

```typescript
export interface CloneWorkerInput {
  // ...existing fields
  proxy?: { enabled: boolean; url: string }
}
```

Replace every `simpleGit(...)` call with a helper:

```typescript
function makeGit(dir?: string) {
  const { proxy } = workerData as CloneWorkerInput
  const configOpts = proxy?.enabled && proxy?.url
    ? { config: [`http.proxy=${proxy.url}`, `https.proxy=${proxy.url}`] }
    : undefined
  return dir ? simpleGit(dir, configOpts) : simpleGit(configOpts)
}
```

All 8 `simpleGit(...)` occurrences in the file become `makeGit(...)`. The `config` option maps to `-c` flags on the underlying `git` command, which is per-invocation and does not affect global/system git configuration.

### 2.4 `server/services/task-scheduler.ts` (modify)

In `startWorker`, just before constructing `workerDataPayload`:

```typescript
const proxy = getProxyConfig(this.db)
```

Add `proxy` into `workerDataPayload` for both marketplace and plugin modes.

### 2.5 `server/index.ts` (modify)

Mount the new router: `app.use('/api/settings', settingsRouter(db))`.

## 3. Frontend

### 3.1 `client/src/pages/Settings.tsx` (new)

Layout:

```
[h1] Settings

[section] Proxy
  [checkbox/toggle] Enable proxy
  [label] Proxy URL
  [input, disabled when toggle is off] http://proxy.example.com:8080
  [helper text] Supports http://, https://, socks5://, socks5h:// — authentication can be included as user:pass@host.
  [button] Save
```

Interaction rules:

- Toggle off: input is **disabled** but value is **preserved** (not cleared).
- On mount: fetch current config via `api.settings.getProxy()`.
- Save: client-side URL validation (same rules as backend) when enabled; show toast on success/error.
- 400 from backend (invalid URL) → show toast with server message.

### 3.2 `client/src/App.tsx` (modify)

Add `Settings` nav link after `Exports`, route `/settings` → `Settings` page.

### 3.3 `client/src/api.ts` (modify)

```typescript
settings: {
  getProxy: () => req<{ enabled: boolean; url: string }>('GET', '/settings/proxy'),
  updateProxy: (config: { enabled: boolean; url: string }) =>
    req<void>('PUT', '/settings/proxy', config),
}
```

## 4. URL Validation

Shared logic (both server and client use the native `URL` constructor):

```typescript
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

function validateProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return `Unsupported protocol "${parsed.protocol}". Use http://, https://, socks5://, or socks5h://`
    }
    if (!parsed.hostname) return 'Proxy URL must include a host'
    return null
  } catch {
    return 'Invalid URL format'
  }
}
```

## 5. Data Flow

```
User opens /settings
  └─ GET /api/settings/proxy → { enabled, url }

User toggles + types + Save
  └─ PUT /api/settings/proxy → writes both keys in DB

User triggers clone (add/refresh marketplace)
  └─ scheduler.startWorker(task)
      └─ reads getProxyConfig(db) from settings table
      └─ spawns Worker with workerData.proxy = { enabled, url }
      └─ worker uses makeGit() → every simpleGit() has -c http.proxy/https.proxy
      └─ git clone/fetch/pull goes through proxy
```

Proxy changes apply **to new workers only**; workers already running continue with the proxy config they were started with. This is acceptable — users just wait for in-flight tasks to finish or stop/resume them.

## 6. Error Handling

- **DB read fails**: treat as `{ enabled: false, url: '' }` (no proxy).
- **Invalid URL on PUT with enabled=true**: return 400, UI shows toast.
- **Proxy unreachable during clone**: git reports the error normally → existing task failure path; the task's message column contains the git error output.

## 7. Files Changed

| File | Change |
|------|--------|
| `server/db.ts` | Add `settings` table |
| `server/services/settings-service.ts` | New: key-value helpers + proxy accessor |
| `server/routes/settings.ts` | New: GET/PUT `/api/settings/proxy` |
| `server/workers/clone-worker.ts` | Add `proxy` to `CloneWorkerInput`; replace all `simpleGit` calls with `makeGit` |
| `server/services/task-scheduler.ts` | Read proxy in `startWorker`, pass via `workerData.proxy` |
| `server/index.ts` | Mount settings router |
| `client/src/pages/Settings.tsx` | New: Settings page |
| `client/src/App.tsx` | Add `/settings` nav + route |
| `client/src/api.ts` | Add `api.settings.*` |
| `tests/db.test.ts` | Verify `settings` table exists |
| `tests/settings-service.test.ts` | New: getProxyConfig / setProxyConfig round-trip |
| `tests/routes/settings.test.ts` | New: GET/PUT endpoints including validation |

## 8. No Data Migration

Existing databases need `data/db.sqlite*` deleted before running (consistent with prior iterations).
