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
})

describe('GET /api/tasks/:id/events', () => {
  it('returns 404 for unknown task id', async () => {
    const res = await request(app).get('/api/tasks/nonexistent/events')
    expect(res.status).toBe(404)
  })
})
