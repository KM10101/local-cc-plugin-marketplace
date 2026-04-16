import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../server/db.js'
import {
  getSetting, setSetting,
  getProxyConfig, setProxyConfig,
  validateProxyUrl,
} from '../server/services/settings-service.js'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-settings-service.sqlite')
let db: Db

beforeEach(() => { db = createDb(TEST_DB) })
afterEach(async () => { db.close(); await rm(TEST_DB, { force: true }) })

describe('getSetting / setSetting', () => {
  it('returns null for missing key', () => {
    expect(getSetting(db, 'nope')).toBeNull()
  })

  it('round-trips a value', () => {
    setSetting(db, 'proxy.url', 'http://a:8080')
    expect(getSetting(db, 'proxy.url')).toBe('http://a:8080')
  })

  it('overwrites on repeat set', () => {
    setSetting(db, 'proxy.url', 'http://a:8080')
    setSetting(db, 'proxy.url', 'http://b:9090')
    expect(getSetting(db, 'proxy.url')).toBe('http://b:9090')
  })
})

describe('getProxyConfig', () => {
  it('returns default when unset', () => {
    expect(getProxyConfig(db)).toEqual({ enabled: false, url: '' })
  })

  it('returns stored config', () => {
    setSetting(db, 'proxy.enabled', 'true')
    setSetting(db, 'proxy.url', 'http://proxy:8080')
    expect(getProxyConfig(db)).toEqual({ enabled: true, url: 'http://proxy:8080' })
  })

  it('treats non-true values as false', () => {
    setSetting(db, 'proxy.enabled', 'false')
    setSetting(db, 'proxy.url', 'http://proxy:8080')
    expect(getProxyConfig(db).enabled).toBe(false)
  })
})

describe('setProxyConfig', () => {
  it('writes both keys', () => {
    setProxyConfig(db, { enabled: true, url: 'http://x:1' })
    expect(getSetting(db, 'proxy.enabled')).toBe('true')
    expect(getSetting(db, 'proxy.url')).toBe('http://x:1')
  })
})

describe('validateProxyUrl', () => {
  it('accepts http://', () => {
    expect(validateProxyUrl('http://proxy.corp:8080')).toBeNull()
  })
  it('accepts https://', () => {
    expect(validateProxyUrl('https://proxy.corp:8443')).toBeNull()
  })
  it('accepts socks5://', () => {
    expect(validateProxyUrl('socks5://127.0.0.1:1080')).toBeNull()
  })
  it('accepts socks5h://', () => {
    expect(validateProxyUrl('socks5h://127.0.0.1:1080')).toBeNull()
  })
  it('accepts URL with user:pass auth', () => {
    expect(validateProxyUrl('http://user:pass@proxy.corp:8080')).toBeNull()
  })
  it('rejects non-URL string', () => {
    expect(validateProxyUrl('not a url')).toMatch(/Invalid URL/i)
  })
  it('rejects unsupported protocol', () => {
    expect(validateProxyUrl('ftp://proxy.corp:8080')).toMatch(/Unsupported protocol/i)
  })
  it('rejects URL without host', () => {
    const msg = validateProxyUrl('http://')
    expect(msg).not.toBeNull()
  })
})
