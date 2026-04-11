import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { PluginCard } from '../components/PluginCard'
import type { Marketplace, Plugin } from '../types'

export default function MarketplaceDetail() {
  const { id } = useParams<{ id: string }>()
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loadingPlugins, setLoadingPlugins] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pluginsError, setPluginsError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.marketplaces.get(id)
      .then(setMarketplace)
      .catch((e: any) => setError(e.message))
    setLoadingPlugins(true)
    api.marketplaces.plugins(id)
      .then(setPlugins)
      .catch((e: any) => setPluginsError(e.message))
      .finally(() => setLoadingPlugins(false))
  }, [id])

  if (error) return <p style={{ color: '#dc2626' }}>Error: {error}</p>
  if (!marketplace) return <p>Loading…</p>

  return (
    <div>
      <Link to="/" style={{ color: '#2563eb', fontSize: 14 }}>← Marketplaces</Link>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '12px 0 4px' }}>{marketplace.name}</h1>
      {marketplace.owner && <p style={{ color: '#6b7280', marginBottom: 4 }}>by {marketplace.owner}</p>}
      {marketplace.description && <p style={{ color: '#4b5563', marginBottom: 8 }}>{marketplace.description}</p>}
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 24 }}>
        {marketplace.repo_url} · commit {marketplace.git_commit_sha?.slice(0, 8) ?? 'unknown'}
        {marketplace.last_updated && ` · updated ${new Date(marketplace.last_updated).toLocaleDateString()}`}
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Plugins{!loadingPlugins && ` (${plugins.length})`}</h2>
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
    </div>
  )
}
