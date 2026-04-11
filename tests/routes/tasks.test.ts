import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import type { Express } from 'express'
import { rm } from 'fs/promises'
import { join } from 'path'
import { createDb } from '../../server/db.js'
import type { Db } from '../../server/db.js'

const TEST_DB = join(process.cwd(), 'data', 'test-tasks.sqlite')
let app: Express
let db: Db

function now() {
  return new Date().toISOString()
}

function insertTask(db: Db, overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'task-1',
    parent_task_id: null,
    type: 'clone_marketplace',
    status: 'queued',
    marketplace_id: null,
    repo_url: 'https://github.com/alpha/repo',
    branch: 'main',
    plugin_id: null,
    progress: 0,
    message: null,
    created_at: now(),
    completed_at: null,
  }
  const t = { ...defaults, ...overrides }
  db.prepare(`
    INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, repo_url, branch, plugin_id, progress, message, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.id, t.parent_task_id, t.type, t.status, t.marketplace_id, t.repo_url, t.branch, t.plugin_id, t.progress, t.message, t.created_at, t.completed_at)
  return t
}

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

  it('returns parent tasks with children nested', async () => {
    insertTask(db, { id: 'parent-1', repo_url: 'https://github.com/test/repo', created_at: '2024-01-01T00:00:00.000Z' })
    insertTask(db, {
      id: 'child-1',
      parent_task_id: 'parent-1',
      type: 'clone_plugin',
      repo_url: 'https://github.com/test/plugin',
      created_at: '2024-01-01T01:00:00.000Z',
    })

    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('parent-1')
    expect(res.body[0].children).toHaveLength(1)
    expect(res.body[0].children[0].id).toBe('child-1')
  })

  it('filters by repo_url when search param is provided', async () => {
    insertTask(db, { id: 'task-alpha', repo_url: 'https://github.com/alpha/repo', created_at: '2024-01-02T00:00:00.000Z' })
    insertTask(db, { id: 'task-beta', repo_url: 'https://github.com/beta/repo', created_at: '2024-01-01T00:00:00.000Z' })

    const res = await request(app).get('/api/tasks?search=alpha')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('task-alpha')
  })
})

describe('POST /api/tasks/:id/stop', () => {
  it('stops a running task', async () => {
    insertTask(db, { id: 'task-running', status: 'running' })

    const res = await request(app).post('/api/tasks/task-running/stop')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get('task-running') as any
    expect(task.status).toBe('stopped')
  })

  it('returns 404 for unknown task', async () => {
    const res = await request(app).post('/api/tasks/nonexistent/stop')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Task not found' })
  })
})

describe('POST /api/tasks/:id/resume', () => {
  it('resumes a stopped task', async () => {
    insertTask(db, { id: 'task-stopped', status: 'stopped' })

    const res = await request(app).post('/api/tasks/task-stopped/resume')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    // resumeTask sets status to 'queued' and calls drainQueue which may advance
    // the status further; verify the task is no longer 'stopped'
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get('task-stopped') as any
    expect(task.status).not.toBe('stopped')
  })

  it('returns 404 for unknown task', async () => {
    const res = await request(app).post('/api/tasks/nonexistent/resume')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Task not found' })
  })
})

describe('DELETE /api/tasks/:id', () => {
  it('deletes a task and its children', async () => {
    insertTask(db, { id: 'parent-del', repo_url: 'https://github.com/del/repo' })
    insertTask(db, {
      id: 'child-del',
      parent_task_id: 'parent-del',
      type: 'clone_plugin',
      repo_url: 'https://github.com/del/plugin',
    })

    const res = await request(app).delete('/api/tasks/parent-del')
    expect(res.status).toBe(204)

    const parent = db.prepare(`SELECT * FROM tasks WHERE id=?`).get('parent-del')
    expect(parent).toBeUndefined()

    const child = db.prepare(`SELECT * FROM tasks WHERE id=?`).get('child-del')
    expect(child).toBeUndefined()
  })

  it('returns 404 for unknown task', async () => {
    const res = await request(app).delete('/api/tasks/nonexistent')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Task not found' })
  })
})

describe('GET /api/tasks/:id/events', () => {
  it('returns 404 for unknown task id', async () => {
    const res = await request(app).get('/api/tasks/nonexistent/events')
    expect(res.status).toBe(404)
  })
})
