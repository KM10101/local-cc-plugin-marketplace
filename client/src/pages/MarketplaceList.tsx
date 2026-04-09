import { useState, useEffect } from 'react'
import { api } from '../api'
import { MarketplaceCard } from '../components/MarketplaceCard'
import type { Marketplace } from '../types'

export default function MarketplaceList() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try { setMarketplaces(await api.marketplaces.list()) }
    catch (e: any) { setError(e.message) }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true); setError(null)
    try {
      await api.marketplaces.add(url.trim())
      setUrl('')
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setAdding(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this marketplace and all its data?')) return
    await api.marketplaces.delete(id)
    await load()
  }

  async function handleRefresh(id: string) {
    await api.marketplaces.refresh(id)
    await load()
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Marketplaces</h1>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          value={url} onChange={e => setUrl(e.target.value)}
          placeholder="GitHub URL or git URL (e.g. owner/repo or https://github.com/owner/repo.git)"
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <button type="submit" disabled={adding}
          style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {adding ? 'Adding…' : 'Add Marketplace'}
        </button>
      </form>

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>{error}</p>}

      {marketplaces.length === 0
        ? <p style={{ color: '#9ca3af' }}>No marketplaces yet. Add one above.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {marketplaces.map(m => (
              <MarketplaceCard key={m.id} marketplace={m} onDelete={handleDelete} onRefresh={handleRefresh} />
            ))}
          </div>
        )
      }
    </div>
  )
}
