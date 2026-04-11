import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import { createDb } from '../../server/db.js'
import type { Db } from '../../server/db.js'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'

const TEST_DB = 'data/test-exports.sqlite'

describe('exports routes', () => {
  let app: ReturnType<typeof createApp>
  let db: Db

  beforeEach(() => {
    app = createApp(TEST_DB)
    db = createDb(TEST_DB)
  })

  afterEach(async () => {
    db.close()
    if (existsSync(TEST_DB)) await rm(TEST_DB)
  })

  it('GET /api/exports returns empty array', async () => {
    const res = await request(app).get('/api/exports')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('POST /api/exports with missing selected_content returns 400', async () => {
    const res = await request(app).post('/api/exports').send({})
    expect(res.status).toBe(400)
  })

  it('GET /api/exports/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/exports/nonexistent')
    expect(res.status).toBe(404)
  })

  it('GET /api/exports/:id/download returns 409 when export not ready', async () => {
    const id = crypto.randomUUID()
    db.prepare(`INSERT INTO exports (id, name, status, progress, message, selected_content, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, 'test', 'packaging', 0, '', '{}')

    const res = await request(app).get(`/api/exports/${id}/download`)
    expect(res.status).toBe(409)
  })

  it('DELETE /api/exports/:id returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/exports/nonexistent')
    expect(res.status).toBe(404)
  })

  it('GET /api/exports filters by plugin name search', async () => {
    // Insert a marketplace
    const mId = crypto.randomUUID()
    db.prepare(`INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(mId, 'https://example.com/repo.git', 'main', 'Test Marketplace', '/tmp/test-marketplace', 'ready')

    // Insert two plugins
    const p1Id = crypto.randomUUID()
    const p2Id = crypto.randomUUID()
    db.prepare(`INSERT INTO plugins (id, marketplace_id, name, source_type, local_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(p1Id, mId, 'my-cool-plugin', 'git', '/tmp/plugin1', 'ready')
    db.prepare(`INSERT INTO plugins (id, marketplace_id, name, source_type, local_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(p2Id, mId, 'other-plugin', 'git', '/tmp/plugin2', 'ready')

    // Insert two exports: one containing p1, one containing p2
    const e1Id = crypto.randomUUID()
    const e2Id = crypto.randomUUID()
    db.prepare(`INSERT INTO exports (id, name, status, progress, selected_content, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(e1Id, 'export-with-cool', 'ready', 100, JSON.stringify({ [mId]: [p1Id] }))
    db.prepare(`INSERT INTO exports (id, name, status, progress, selected_content, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(e2Id, 'export-with-other', 'ready', 100, JSON.stringify({ [mId]: [p2Id] }))

    // Search for "cool" — should return only the first export
    const res = await request(app).get('/api/exports?search=cool')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(e1Id)
  })

  it('GET /api/exports/:id returns export with plugin details', async () => {
    // Insert a marketplace
    const mId = crypto.randomUUID()
    db.prepare(`INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(mId, 'https://example.com/repo.git', 'feat-branch', 'Detail Marketplace', '/tmp/detail-marketplace', 'ready')

    // Insert a plugin
    const pId = crypto.randomUUID()
    db.prepare(`INSERT INTO plugins (id, marketplace_id, name, version, author, description, source_type, local_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(pId, mId, 'detail-plugin', '1.0.0', 'Alice', 'A plugin', 'git', '/tmp/detail-plugin', 'ready')

    // Insert an export referencing that plugin
    const eId = crypto.randomUUID()
    db.prepare(`INSERT INTO exports (id, name, status, progress, selected_content, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(eId, 'detail-export', 'ready', 100, JSON.stringify({ [mId]: [pId] }))

    const res = await request(app).get(`/api/exports/${eId}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(eId)
    expect(Array.isArray(res.body.plugins)).toBe(true)
    expect(res.body.plugins).toHaveLength(1)

    const plugin = res.body.plugins[0]
    expect(plugin.id).toBe(pId)
    expect(plugin.name).toBe('detail-plugin')
    expect(plugin.marketplace_name).toBe('Detail Marketplace')
    expect(plugin.marketplace_branch).toBe('feat-branch')
  })
})
