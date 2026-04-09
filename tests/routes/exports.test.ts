import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import { createDb } from '../../server/db.js'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'

const TEST_DB = 'data/test-exports.sqlite'

describe('exports routes', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp(TEST_DB)
  })

  afterEach(async () => {
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
    // Insert a packaging export directly
    const db = createDb(TEST_DB)
    const id = crypto.randomUUID()
    db.prepare(`INSERT INTO exports (id, name, status, progress, message, selected_content, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, 'test', 'packaging', 0, '', '{}')
    db.close()

    const res = await request(app).get(`/api/exports/${id}/download`)
    expect(res.status).toBe(409)
  })

  it('DELETE /api/exports/:id returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/exports/nonexistent')
    expect(res.status).toBe(404)
  })
})
