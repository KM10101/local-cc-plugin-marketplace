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
