import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/index.js'
import { createDb, type Db } from '../../server/db.js'
import type { Express } from 'express'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-marketplaces.sqlite')
let app: Express
let db: Db

beforeEach(() => {
  app = createApp(TEST_DB)
  // Open a separate DB handle for direct inserts/queries in tests
  db = createDb(TEST_DB)
})

afterEach(async () => {
  db.close()
  await rm(TEST_DB, { force: true })
})

function insertMarketplace(overrides: Partial<{
  id: string; repo_url: string; branch: string; name: string;
  local_path: string; status: string; created_at: string
}> = {}) {
  const id = overrides.id ?? crypto.randomUUID()
  const repo_url = overrides.repo_url ?? 'https://github.com/owner/repo.git'
  const branch = overrides.branch ?? 'main'
  const name = overrides.name ?? 'repo'
  const local_path = overrides.local_path ?? `/tmp/test/${id}`
  const status = overrides.status ?? 'ready'
  const created_at = overrides.created_at ?? new Date().toISOString()

  db.prepare(`INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, repo_url, branch, name, local_path, status, created_at)
  return { id, repo_url, branch, name, local_path, status, created_at }
}

function insertPlugin(marketplaceId: string, overrides: Partial<{
  id: string; name: string; source_type: string; local_path: string; status: string
}> = {}) {
  const id = overrides.id ?? crypto.randomUUID()
  const name = overrides.name ?? 'test-plugin'
  const source_type = overrides.source_type ?? 'local'
  const local_path = overrides.local_path ?? `/tmp/test/${id}`
  const status = overrides.status ?? 'ready'

  db.prepare(`INSERT INTO plugins (id, marketplace_id, name, source_type, local_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, marketplaceId, name, source_type, local_path, status, new Date().toISOString())
  return { id, name }
}

describe('GET /api/marketplaces', () => {
  it('returns empty array when no marketplaces', async () => {
    const res = await request(app).get('/api/marketplaces')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns marketplaces with plugin_count', async () => {
    const m = insertMarketplace({ name: 'my-market' })
    insertPlugin(m.id, { name: 'plugin-a' })
    insertPlugin(m.id, { name: 'plugin-b' })

    const res = await request(app).get('/api/marketplaces')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].plugin_count).toBe(2)
  })

  it('filters by search query on name', async () => {
    insertMarketplace({ name: 'alpha-tools' })
    insertMarketplace({ id: crypto.randomUUID(), repo_url: 'https://github.com/other/beta.git', name: 'beta-utils' })

    const res = await request(app).get('/api/marketplaces?search=alpha')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('alpha-tools')
  })
})

describe('POST /api/marketplaces', () => {
  it('rejects missing repo_url', async () => {
    const res = await request(app).post('/api/marketplaces').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('creates marketplace with repo_url and default branch=main', async () => {
    const res = await request(app)
      .post('/api/marketplaces')
      .send({ repo_url: 'https://github.com/owner/repo.git' })
    expect(res.status).toBe(202)
    expect(res.body.marketplace_id).toBeDefined()
    expect(res.body.task_id).toBeDefined()

    // Verify marketplace has branch='main'
    const row = db.prepare(`SELECT branch FROM marketplaces WHERE id=?`).get(res.body.marketplace_id) as any
    expect(row.branch).toBe('main')
  })

  it('creates marketplace with specified branch', async () => {
    const res = await request(app)
      .post('/api/marketplaces')
      .send({ repo_url: 'https://github.com/owner/repo.git', branch: 'develop' })
    expect(res.status).toBe(202)

    const row = db.prepare(`SELECT branch FROM marketplaces WHERE id=?`).get(res.body.marketplace_id) as any
    expect(row.branch).toBe('develop')
  })

  it('accepts source_url for backwards compat', async () => {
    const res = await request(app)
      .post('/api/marketplaces')
      .send({ source_url: 'https://github.com/owner/repo.git' })
    expect(res.status).toBe(202)
    expect(res.body.marketplace_id).toBeDefined()
  })

  it('returns 409 on duplicate repo_url+branch', async () => {
    insertMarketplace({ repo_url: 'https://github.com/owner/repo.git', branch: 'main' })

    const res = await request(app)
      .post('/api/marketplaces')
      .send({ repo_url: 'https://github.com/owner/repo.git', branch: 'main' })
    expect(res.status).toBe(409)
  })

  it('returns 409 when 5 branches already exist for repo', async () => {
    const repoUrl = 'https://github.com/owner/big-repo.git'
    for (let i = 0; i < 5; i++) {
      insertMarketplace({
        id: crypto.randomUUID(),
        repo_url: repoUrl,
        branch: `branch-${i}`,
      })
    }

    const res = await request(app)
      .post('/api/marketplaces')
      .send({ repo_url: repoUrl, branch: 'branch-6' })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/marketplaces/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/marketplaces/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns marketplace with siblings', async () => {
    const repoUrl = 'https://github.com/owner/repo.git'
    const m1 = insertMarketplace({ repo_url: repoUrl, branch: 'main', name: 'repo' })
    const m2 = insertMarketplace({ id: crypto.randomUUID(), repo_url: repoUrl, branch: 'develop', name: 'repo' })

    const res = await request(app).get(`/api/marketplaces/${m1.id}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(m1.id)
    expect(res.body.siblings).toHaveLength(1)
    expect(res.body.siblings[0].id).toBe(m2.id)
    expect(res.body.siblings[0].branch).toBe('develop')
  })

  it('returns empty siblings array for single-branch marketplace', async () => {
    const m = insertMarketplace()

    const res = await request(app).get(`/api/marketplaces/${m.id}`)
    expect(res.status).toBe(200)
    expect(res.body.siblings).toEqual([])
  })
})

describe('POST /:id/branches', () => {
  it('returns 404 for unknown marketplace', async () => {
    const res = await request(app)
      .post('/api/marketplaces/nonexistent/branches')
      .send({ branch: 'develop' })
    expect(res.status).toBe(404)
  })

  it('returns 400 if branch not provided', async () => {
    const m = insertMarketplace()
    const res = await request(app)
      .post(`/api/marketplaces/${m.id}/branches`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('creates a new branch marketplace from existing one', async () => {
    const m = insertMarketplace()
    const res = await request(app)
      .post(`/api/marketplaces/${m.id}/branches`)
      .send({ branch: 'develop' })
    expect(res.status).toBe(202)
    expect(res.body.marketplace_id).toBeDefined()

    // Verify the new marketplace has the same repo_url but different branch
    const row = db.prepare(`SELECT repo_url, branch FROM marketplaces WHERE id=?`).get(res.body.marketplace_id) as any
    expect(row.repo_url).toBe(m.repo_url)
    expect(row.branch).toBe('develop')
  })
})

describe('GET /api/marketplaces/repo-branches', () => {
  it('returns 400 if repo_url not provided', async () => {
    const res = await request(app).get('/api/marketplaces/repo-branches')
    expect(res.status).toBe(400)
  })

  it('returns branches for a given repo_url', async () => {
    const repoUrl = 'https://github.com/owner/repo.git'
    insertMarketplace({ repo_url: repoUrl, branch: 'main' })
    insertMarketplace({ id: crypto.randomUUID(), repo_url: repoUrl, branch: 'develop' })

    const res = await request(app)
      .get('/api/marketplaces/repo-branches')
      .query({ repo_url: repoUrl })
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })
})

describe('DELETE /api/marketplaces/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/marketplaces/nonexistent')
    expect(res.status).toBe(404)
  })

  it('deletes marketplace and its plugins', async () => {
    const m = insertMarketplace()
    insertPlugin(m.id, { name: 'p1' })
    insertPlugin(m.id, { name: 'p2' })

    const res = await request(app).delete(`/api/marketplaces/${m.id}`)
    expect(res.status).toBe(204)

    // Verify plugins are also deleted
    const plugins = db.prepare(`SELECT * FROM plugins WHERE marketplace_id=?`).all(m.id)
    expect(plugins).toHaveLength(0)
  })
})

describe('POST /api/marketplaces/:id/refresh', () => {
  it('returns 404 for unknown marketplace', async () => {
    const res = await request(app).post('/api/marketplaces/nonexistent/refresh')
    expect(res.status).toBe(404)
  })

  it('returns 409 if active task exists', async () => {
    const m = insertMarketplace()
    // Insert an active task for this repo_url+branch
    db.prepare(`INSERT INTO tasks (id, type, status, marketplace_id, repo_url, branch, progress, created_at)
      VALUES (?, 'clone_marketplace', 'running', ?, ?, ?, 0, ?)`
    ).run(crypto.randomUUID(), m.id, m.repo_url, m.branch, new Date().toISOString())

    const res = await request(app).post(`/api/marketplaces/${m.id}/refresh`)
    expect(res.status).toBe(409)
  })
})

describe('GET /api/marketplaces/:id/plugins', () => {
  it('returns plugins for marketplace', async () => {
    const m = insertMarketplace()
    insertPlugin(m.id, { name: 'alpha-plugin' })
    insertPlugin(m.id, { name: 'beta-plugin' })

    const res = await request(app).get(`/api/marketplaces/${m.id}/plugins`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('filters plugins by search query', async () => {
    const m = insertMarketplace()
    insertPlugin(m.id, { name: 'alpha-plugin' })
    insertPlugin(m.id, { name: 'beta-plugin' })

    const res = await request(app).get(`/api/marketplaces/${m.id}/plugins?search=alpha`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('alpha-plugin')
  })
})
