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
