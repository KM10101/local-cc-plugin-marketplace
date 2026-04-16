import { useState, useEffect } from 'react'
import { api } from '../api'
import { useToast } from '../components/Toast'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

function validateProxyUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return `Unsupported protocol "${parsed.protocol}". Use http://, https://, socks5://, or socks5h://`
  }
  if (!parsed.hostname) return 'Proxy URL must include a host'
  return null
}

export default function Settings() {
  const { showToast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.settings.getProxy()
      .then(cfg => { setEnabled(cfg.enabled); setUrl(cfg.url) })
      .catch((e: any) => showToast('error', e.message ?? 'Failed to load settings'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (enabled && url.trim().length > 0) {
      const err = validateProxyUrl(url)
      if (err) {
        showToast('error', err)
        return
      }
    }
    setSaving(true)
    try {
      await api.settings.updateProxy({ enabled, url })
      showToast('success', 'Proxy settings saved')
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ color: '#9ca3af' }}>Loading…</p>
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: '#fff', maxWidth: 640 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>Proxy</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 16px' }}>
          Configure an HTTP, HTTPS, or SOCKS proxy for all git clone, fetch, and pull operations.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Enable proxy</span>
        </label>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: enabled ? '#111827' : '#9ca3af' }}>
            Proxy URL
          </label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={!enabled}
            placeholder="http://proxy.example.com:8080"
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: '1px solid #d1d5db', fontSize: 14,
              background: enabled ? '#fff' : '#f3f4f6',
              color: enabled ? '#111827' : '#9ca3af',
            }}
          />
          <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0' }}>
            Supports <code>http://</code>, <code>https://</code>, <code>socks5://</code>, <code>socks5h://</code>.
            Authentication can be included inline, e.g. <code>http://user:pass@proxy:8080</code>.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 16px', background: '#2563eb', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>
    </div>
  )
}
