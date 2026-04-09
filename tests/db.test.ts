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
  it('creates all required tables', () => {
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
})
