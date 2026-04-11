import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import type { Marketplace } from '../types.js'
import { readPluginJson, parseMarketplaceJson } from './plugin-service.js'
import type { ClonePluginResult } from '../workers/clone-worker.js'
import type { TaskScheduler } from './task-scheduler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function now() { return new Date().toISOString() }
function uuid() { return crypto.randomUUID() }

function repoNameFromUrl(url: string): string {
  const parts = url.replace(/\.git$/, '').split('/')
  return parts[parts.length - 1] || url
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export function addMarketplace(
  db: Db,
  scheduler: TaskScheduler,
  options: { repoUrl: string; branch?: string; reposDir: string }
): { marketplace_id: string; task_id: string } {
  const { repoUrl, reposDir } = options
  const branch = options.branch || 'main'

  // Validate: no duplicate (repo_url, branch)
  const existing = db.prepare(`SELECT id FROM marketplaces WHERE repo_url=? AND branch=?`).get(repoUrl, branch)
  if (existing) {
    throw new ConflictError(`Marketplace already exists for ${repoUrl} branch ${branch}`)
  }

  // Validate: max 5 branches per repo_url
  const branchCount = db.prepare(`SELECT COUNT(*) as cnt FROM marketplaces WHERE repo_url=?`).get(repoUrl) as { cnt: number }
  if (branchCount.cnt >= 5) {
    throw new ConflictError(`Maximum of 5 branches per repository reached for ${repoUrl}`)
  }

  // Validate: no active task for this (repo_url, branch)
  if (scheduler.hasActiveTask(repoUrl, branch)) {
    throw new ConflictError(`An active task already exists for ${repoUrl} branch ${branch}`)
  }

  const marketplace_id = uuid()
  const task_id = uuid()
  const localPath = join(reposDir, 'marketplaces', marketplace_id)

  db.prepare(`INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'cloning', ?)`
  ).run(marketplace_id, repoUrl, branch, repoNameFromUrl(repoUrl), localPath, now())

  db.prepare(`INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, repo_url, branch, progress, created_at)
    VALUES (?, NULL, 'clone_marketplace', 'queued', ?, ?, ?, 0, ?)`
  ).run(task_id, marketplace_id, repoUrl, branch, now())

  scheduler.enqueue(task_id)

  return { marketplace_id, task_id }
}

export function refreshMarketplace(
  db: Db,
  scheduler: TaskScheduler,
  id: string,
  reposDir: string
): { marketplace_id: string; task_id: string } | null {
  const marketplace = db.prepare(`SELECT * FROM marketplaces WHERE id=?`).get(id) as Marketplace | undefined
  if (!marketplace) return null

  // Check for active task
  if (scheduler.hasActiveTask(marketplace.repo_url, marketplace.branch)) {
    throw new ConflictError(`An active task already exists for ${marketplace.repo_url} branch ${marketplace.branch}`)
  }

  const task_id = uuid()

  db.prepare(`UPDATE marketplaces SET status='cloning' WHERE id=?`).run(id)
  db.prepare(`INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, repo_url, branch, progress, created_at)
    VALUES (?, NULL, 'clone_marketplace', 'queued', ?, ?, ?, 0, ?)`
  ).run(task_id, id, marketplace.repo_url, marketplace.branch, now())

  scheduler.enqueue(task_id)

  return { marketplace_id: id, task_id }
}

export function listMarketplaces(db: Db, search?: string) {
  if (search) {
    return db.prepare(`
      SELECT m.*, COUNT(p.id) as plugin_count
      FROM marketplaces m
      LEFT JOIN plugins p ON p.marketplace_id = m.id
      WHERE m.name LIKE ?
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `).all(`%${search}%`)
  }
  return db.prepare(`
    SELECT m.*, COUNT(p.id) as plugin_count
    FROM marketplaces m
    LEFT JOIN plugins p ON p.marketplace_id = m.id
    GROUP BY m.id
    ORDER BY m.created_at DESC
  `).all()
}

export function getMarketplace(db: Db, id: string) {
  const marketplace = db.prepare(`SELECT * FROM marketplaces WHERE id=?`).get(id) as Marketplace | undefined
  if (!marketplace) return null

  const siblings = db.prepare(
    `SELECT * FROM marketplaces WHERE repo_url=? AND id != ? ORDER BY branch`
  ).all(marketplace.repo_url, id) as Marketplace[]

  return { ...marketplace, siblings }
}

export function getMarketplacePlugins(db: Db, marketplace_id: string, search?: string) {
  if (search) {
    return db.prepare(`SELECT * FROM plugins WHERE marketplace_id=? AND name LIKE ? ORDER BY name`).all(marketplace_id, `%${search}%`)
  }
  return db.prepare(`SELECT * FROM plugins WHERE marketplace_id=? ORDER BY name`).all(marketplace_id)
}

export function getRepoBranches(db: Db, repoUrl: string) {
  return db.prepare(`SELECT * FROM marketplaces WHERE repo_url=? ORDER BY branch`).all(repoUrl) as Marketplace[]
}

export function deleteMarketplace(db: Db, id: string, reposDir: string): boolean {
  const row = db.prepare(`SELECT local_path FROM marketplaces WHERE id=?`).get(id) as { local_path: string } | undefined
  if (!row) return false
  db.prepare(`DELETE FROM plugins WHERE marketplace_id=?`).run(id)
  db.prepare(`DELETE FROM marketplaces WHERE id=?`).run(id)
  const pluginDir = join(reposDir, 'plugins', id)
  if (existsSync(row.local_path)) rm(row.local_path, { recursive: true, force: true }).catch(() => {})
  if (existsSync(pluginDir)) rm(pluginDir, { recursive: true, force: true }).catch(() => {})
  return true
}

export async function persistCloneResults(db: Db, marketplace_id: string, gitSha: string, plugins: ClonePluginResult[]) {
  const marketplace = db.prepare(`SELECT local_path FROM marketplaces WHERE id=?`).get(marketplace_id) as { local_path: string }

  let name = marketplace_id
  let description: string | null = null
  let owner: string | null = null
  try {
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
