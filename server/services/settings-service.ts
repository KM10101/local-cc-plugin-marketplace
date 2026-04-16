import type { Db } from '../db.js'

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

function now() { return new Date().toISOString() }

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, value, now())
}

export function getProxyConfig(db: Db): ProxyConfig {
  const enabled = getSetting(db, 'proxy.enabled') === 'true'
  const url = getSetting(db, 'proxy.url') ?? ''
  return { enabled, url }
}

export function setProxyConfig(db: Db, config: ProxyConfig): void {
  setSetting(db, 'proxy.enabled', config.enabled ? 'true' : 'false')
  setSetting(db, 'proxy.url', config.url)
}

export function validateProxyUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return `Unsupported protocol "${parsed.protocol}". Use http://, https://, socks5://, or socks5h://`
  }
  if (!parsed.hostname) return 'Proxy URL must include a host'
  return null
}
