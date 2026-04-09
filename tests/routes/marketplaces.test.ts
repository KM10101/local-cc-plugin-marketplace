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
