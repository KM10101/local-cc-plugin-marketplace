import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { MarketplaceCard } from '../components/MarketplaceCard'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import { SearchInput } from '../components/SearchInput'
import type { Marketplace } from '../types'

export default function MarketplaceList() {
  const { showToast } = useToast()

  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [search, setSearch] = useState('')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const load = useCallback(async (searchTerm?: string) => {
    setLoading(true)
    try {
      setMarketplaces(await api.marketplaces.list(searchTerm))
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to load marketplaces')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { load(search) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true)
    try {
      await api.marketplaces.add(url.trim(), branch.trim() || undefined)
      setUrl('')
      setBranch('')
      showToast('success', 'Marketplace added successfully')
      await load(search)
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status
      if (status === 409) {
        showToast('error', 'This marketplace URL already exists')
      } else {
        showToast('error', e.message ?? 'Failed to add marketplace')
      }
    } finally {
      setAdding(false)
    }
  }

  function handleDeleteRequest(id: string) {
    setDeleteTarget(id)
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget
    setDeleteTarget(null)
    try {
      await api.marketplaces.delete(id)
      showToast('success', 'Marketplace deleted')
      await load(search)
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to delete marketplace')
    }
  }

  async function handleRefresh(id: string) {
    setRefreshingIds(prev => new Set(prev).add(id))
    try {
      await api.marketplaces.refresh(id)
      showToast('success', 'Refresh started')
      await load(search)
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to refresh marketplace')
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // Group marketplaces by repo_url
  const groups = marketplaces.reduce<Map<string, Marketplace[]>>((acc, m) => {
    const key = m.repo_url
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(m)
    return acc
  }, new Map())

  const deleteTargetName = deleteTarget
    ? marketplaces.find(m => m.id === deleteTarget)?.name ?? 'this marketplace'
    : ''

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Marketplaces</h1>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="GitHub URL or git URL (e.g. owner/repo or https://github.com/owner/repo.git)"
          style={{ flex: 2, minWidth: 240, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <input
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          style={{ flex: '0 0 120px', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={adding}
          style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}
        >
          {adding ? 'Adding…' : 'Add Marketplace'}
        </button>
      </form>

      <div style={{ marginBottom: 20 }}>
        <SearchInput
          placeholder="Search marketplaces…"
          value={search}
          onChange={setSearch}
          debounceMs={300}
        />
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : marketplaces.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>
          {search ? 'No marketplaces match your search.' : 'No marketplaces yet. Add one above.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Array.from(groups.entries()).map(([repoUrl, items]) => (
            <div key={repoUrl}>
              {items.length > 1 && (
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>
                  {repoUrl} — {items.length} branches
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                {items.map(m => (
                  <MarketplaceCard
                    key={m.id}
                    marketplace={m}
                    onDelete={handleDeleteRequest}
                    onRefresh={handleRefresh}
                    refreshingIds={refreshingIds}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Marketplace"
        message={`Delete "${deleteTargetName}" and all its data? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
