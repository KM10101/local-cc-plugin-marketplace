import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { PluginCard } from '../components/PluginCard'
import { ConfirmModal } from '../components/ConfirmModal'
import { SearchInput } from '../components/SearchInput'
import { useToast } from '../components/Toast'
import type { Marketplace, Plugin } from '../types'

const MAX_BRANCHES = 5

export default function MarketplaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [marketplace, setMarketplace] = useState<Marketplace | null>(null)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loadingMarketplace, setLoadingMarketplace] = useState(true)
  const [loadingPlugins, setLoadingPlugins] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pluginsError, setPluginsError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [addingBranch, setAddingBranch] = useState(false)
  const [deleteBranchTarget, setDeleteBranchTarget] = useState<{ id: string; branch: string } | null>(null)
  const [deletingBranch, setDeletingBranch] = useState(false)

  const loadMarketplace = useCallback(() => {
    if (!id) return
    api.marketplaces.get(id)
      .then(setMarketplace)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoadingMarketplace(false))
  }, [id])

  const loadPlugins = useCallback((searchTerm?: string) => {
    if (!id) return
    setLoadingPlugins(true)
    setPluginsError(null)
    api.marketplaces.plugins(id, searchTerm)
      .then(setPlugins)
      .catch((e: any) => setPluginsError(e.message))
      .finally(() => setLoadingPlugins(false))
  }, [id])

  useEffect(() => {
    loadMarketplace()
    loadPlugins()
  }, [loadMarketplace, loadPlugins])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    loadPlugins(value || undefined)
  }

  const handleAddBranch = async () => {
    if (!id || !newBranch.trim()) return
    setAddingBranch(true)
    try {
      await api.marketplaces.addBranch(id, newBranch.trim())
      showToast('success', `Branch "${newBranch.trim()}" added successfully`)
      setNewBranch('')
      loadMarketplace()
    } catch (e: any) {
      showToast('error', e.message || 'Failed to add branch')
    } finally {
      setAddingBranch(false)
    }
  }

  const handleDeleteBranchConfirm = async () => {
    if (!deleteBranchTarget) return
    setDeletingBranch(true)
    const target = deleteBranchTarget
    const isCurrentBranch = target.id === id
    try {
      await api.marketplaces.delete(target.id)
      showToast('success', `Branch "${target.branch}" deleted`)
      setDeleteBranchTarget(null)
      if (isCurrentBranch) {
        // Navigate to first sibling or back to list
        const siblings = marketplace?.siblings ?? []
        const remaining = siblings.filter(s => s.id !== target.id)
        if (remaining.length > 0) {
          navigate(`/marketplaces/${remaining[0].id}`)
        } else {
          navigate('/')
        }
      } else {
        loadMarketplace()
      }
    } catch (e: any) {
      showToast('error', e.message || 'Failed to delete branch')
    } finally {
      setDeletingBranch(false)
    }
  }

  if (error) return <p style={{ color: '#dc2626' }}>Error: {error}</p>
  if (loadingMarketplace || !marketplace) return <p style={{ color: '#9ca3af' }}>Loading…</p>

  const siblings = marketplace.siblings ?? []
  // All branches = current + siblings
  const allBranches = [
    { id: marketplace.id, branch: marketplace.branch, status: marketplace.status, isCurrent: true },
    ...siblings.map(s => ({ ...s, isCurrent: false })),
  ]
  const branchCount = allBranches.length
  const atLimit = branchCount >= MAX_BRANCHES

  return (
    <div>
      <Link to="/" style={{ color: '#2563eb', fontSize: 14 }}>← Marketplaces</Link>

      {/* Header */}
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '12px 0 4px' }}>{marketplace.name}</h1>
      {marketplace.owner && <p style={{ color: '#6b7280', marginBottom: 4 }}>by {marketplace.owner}</p>}
      {marketplace.description && <p style={{ color: '#4b5563', marginBottom: 8 }}>{marketplace.description}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
          {marketplace.repo_url}
          {marketplace.git_commit_sha && ` · commit ${marketplace.git_commit_sha.slice(0, 8)}`}
          {marketplace.last_updated && ` · updated ${new Date(marketplace.last_updated).toLocaleDateString()}`}
        </p>
        <span style={{
          background: '#dbeafe', color: '#1d4ed8',
          fontSize: 11, fontWeight: 600, padding: '2px 8px',
          borderRadius: 9999, whiteSpace: 'nowrap',
        }}>
          {marketplace.branch}
        </span>
      </div>

      {/* Branch Management */}
      <div style={{
        background: '#f3f4f6', borderRadius: 10, padding: 16, marginBottom: 28,
        border: '1px solid #e5e7eb',
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#374151' }}>
          Branches ({branchCount}/{MAX_BRANCHES})
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {allBranches.map(b => (
            <div
              key={b.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: b.isCurrent ? '#dbeafe' : '#fff',
                border: `1px solid ${b.isCurrent ? '#93c5fd' : '#d1d5db'}`,
                borderRadius: 6, padding: '4px 8px',
              }}
            >
              {b.isCurrent ? (
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>
                  {b.branch}
                </span>
              ) : (
                <Link
                  to={`/marketplaces/${b.id}`}
                  style={{ fontSize: 13, color: '#374151', textDecoration: 'none' }}
                >
                  {b.branch}
                </Link>
              )}
              <button
                onClick={() => setDeleteBranchTarget({ id: b.id, branch: b.branch })}
                title={`Delete branch "${b.branch}"`}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px',
                  display: 'flex', alignItems: 'center',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Add Branch */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !atLimit && newBranch.trim()) handleAddBranch() }}
            placeholder="Branch name…"
            disabled={atLimit || addingBranch}
            style={{
              border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px',
              fontSize: 13, outline: 'none', flex: 1, maxWidth: 220,
              background: atLimit ? '#f9fafb' : '#fff',
              color: atLimit ? '#9ca3af' : '#111827',
            }}
          />
          <button
            onClick={handleAddBranch}
            disabled={atLimit || addingBranch || !newBranch.trim()}
            style={{
              background: atLimit || !newBranch.trim() ? '#e5e7eb' : '#2563eb',
              color: atLimit || !newBranch.trim() ? '#9ca3af' : '#fff',
              border: 'none', borderRadius: 6, padding: '6px 14px',
              fontSize: 13, cursor: atLimit || !newBranch.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {addingBranch ? 'Adding…' : 'Add Branch'}
          </button>
          {atLimit && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>Maximum branches reached</span>
          )}
        </div>
      </div>

      {/* Plugin Search + Grid */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Plugins{!loadingPlugins && ` (${plugins.length})`}
        </h2>
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Search plugins…"
        />
      </div>

      {loadingPlugins
        ? <p style={{ color: '#9ca3af' }}>Loading plugins…</p>
        : pluginsError
        ? <p style={{ color: '#dc2626' }}>Error: {pluginsError}</p>
        : plugins.length === 0
        ? <p style={{ color: '#9ca3af' }}>No plugins found.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {plugins.map(p => <PluginCard key={p.id} plugin={p} />)}
          </div>
        )
      }

      {/* Confirm Delete Branch Modal */}
      <ConfirmModal
        open={!!deleteBranchTarget}
        title="Delete Branch"
        message={
          deleteBranchTarget?.id === id
            ? `Delete the current branch "${deleteBranchTarget?.branch}"? You will be redirected.`
            : `Delete branch "${deleteBranchTarget?.branch}"? This cannot be undone.`
        }
        confirmLabel={deletingBranch ? 'Deleting…' : 'Delete'}
        onConfirm={handleDeleteBranchConfirm}
        onCancel={() => setDeleteBranchTarget(null)}
      />
    </div>
  )
}
