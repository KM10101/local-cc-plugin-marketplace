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
  it('creates all 4 tables', () => {
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

  it('marketplaces table has repo_url and branch columns', () => {
    const cols = db.prepare(`PRAGMA table_info(marketplaces)`).all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('repo_url')
    expect(colNames).toContain('branch')
    expect(colNames).not.toContain('source_url')
  })

  it('enforces UNIQUE(repo_url, branch) constraint', () => {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
      VALUES ('m1', 'https://github.com/test/repo', 'main', 'Test', '/tmp/test', 'pending', ?)
    `).run(now)

    expect(() => {
      db.prepare(`
        INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
        VALUES ('m2', 'https://github.com/test/repo', 'main', 'Test2', '/tmp/test2', 'pending', ?)
      `).run(now)
    }).toThrow()
  })

  it('allows same repo_url with different branches', () => {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
      VALUES ('m1', 'https://github.com/test/repo', 'main', 'Test', '/tmp/test', 'pending', ?)
    `).run(now)

    expect(() => {
      db.prepare(`
        INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
        VALUES ('m2', 'https://github.com/test/repo', 'dev', 'Test Dev', '/tmp/test-dev', 'pending', ?)
      `).run(now)
    }).not.toThrow()
  })

  it('tasks table has parent_task_id, repo_url, branch, plugin_id columns', () => {
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('parent_task_id')
    expect(colNames).toContain('repo_url')
    expect(colNames).toContain('branch')
    expect(colNames).toContain('plugin_id')
  })

  it('tasks default status is queued', () => {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO tasks (id, type, created_at)
      VALUES ('t1', 'clone_marketplace', ?)
    `).run(now)

    const task = db.prepare(`SELECT status FROM tasks WHERE id = 't1'`).get() as { status: string }
    expect(task.status).toBe('queued')
  })

  it('plugins table has source_format and subdir_path columns', () => {
    const cols = db.prepare(`PRAGMA table_info(plugins)`).all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('source_format')
    expect(colNames).toContain('subdir_path')
  })

  it('tasks table has source_format, subdir_path, and plugin_name columns', () => {
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('source_format')
    expect(colNames).toContain('subdir_path')
    expect(colNames).toContain('plugin_name')
  })
})
