import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { SearchInput } from '../components/SearchInput'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import type { Export } from '../types'

interface PluginRow {
  id: string
  name: string
  version: string | null
  marketplace_name: string
  marketplace_branch: string
}

export default function ExportList() {
  const [exports, setExports] = useState<Export[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pluginRows, setPluginRows] = useState<Record<string, PluginRow[]>>({})
  const [pluginsLoading, setPluginsLoading] = useState<Record<string, boolean>>({})
  const sources = useRef<Map<string, EventSource>>(new Map())
  const { showToast } = useToast()

  useEffect(() => {
    load(search)
    return () => { sources.current.forEach(s => s.close()) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function load(q: string) {
    api.exports.list(q || undefined).then(list => {
      setExports(list)
      list.filter((e: Export) => e.status === 'packaging').forEach(subscribeToExport)
    }).catch((e: any) => setError(e.message))
  }

  function handleSearch(value: string) {
    setSearch(value)
    load(value)
  }

  function subscribeToExport(exp: Export) {
    if (sources.current.has(exp.id)) return
    const es = api.exports.events(exp.id)
    sources.current.set(exp.id, es)
    es.onmessage = (e) => {
      const updated = JSON.parse(e.data) as Export
      setExports(prev => prev.map(x => x.id === updated.id ? updated : x))
      if (updated.status !== 'packaging') { es.close(); sources.current.delete(exp.id) }
    }
    es.onerror = () => { es.close(); sources.current.delete(exp.id) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget
    setDeleteTarget(null)
    try {
      await api.exports.delete(id)
      setExports(prev => prev.filter(e => e.id !== id))
      showToast('success', 'Export deleted.')
    } catch (e: any) {
      showToast('error', `Delete failed: ${e.message}`)
    }
  }

  async function togglePlugins(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (pluginRows[id]) return
    setPluginsLoading(prev => ({ ...prev, [id]: true }))
    try {
      const detail = await api.exports.get(id)
      const rows: PluginRow[] = (detail.plugins ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        version: p.version ?? null,
        marketplace_name: p.marketplace_name,
        marketplace_branch: p.marketplace_branch,
      }))
      setPluginRows(prev => ({ ...prev, [id]: rows }))
    } catch {
      setPluginRows(prev => ({ ...prev, [id]: [] }))
    } finally {
      setPluginsLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Exports</h1>
        <Link to="/export/new">
          <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            New Export
          </button>
        </Link>
      </div>

      <div style={{ marginBottom: 16 }}>
        <SearchInput
          placeholder="Filter by plugin name..."
          value={search}
          onChange={handleSearch}
        />
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>Error: {error}</p>}

      {exports.length === 0
        ? <p style={{ color: '#9ca3af' }}>No exports yet. <Link to="/export/new" style={{ color: '#2563eb' }}>Create one</Link>.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exports.map(e => {
              let content: Record<string, string[]> = {}
              try { content = JSON.parse(e.selected_content || '{}') } catch { /* keep empty */ }
              const marketplaceCount = Object.keys(content).length
              const pluginCount = Object.values(content).flat().length
              const isExpanded = expandedId === e.id
              const plugins = pluginRows[e.id] ?? []
              const loading = pluginsLoading[e.id] ?? false

              return (
                <div key={e.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{e.name}</strong>
                      <span style={{ marginLeft: 12, color: '#6b7280', fontSize: 13 }}>
                        {marketplaceCount} marketplace{marketplaceCount !== 1 ? 's' : ''}, {pluginCount} plugin{pluginCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <StatusBadge status={e.status} />
                  </div>

                  {e.status === 'packaging' && (
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar value={e.progress} message={e.message} />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                    {e.status === 'ready' && (
                      <>
                        <a href={api.exports.downloadUrl(e.id)}>
                          <button style={{ padding: '4px 12px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                            Download {e.zip_size ? `(${(e.zip_size / 1024 / 1024).toFixed(1)} MB)` : ''}
                          </button>
                        </a>
                        <Link to={`/export/${e.id}`} style={{ color: '#2563eb', fontSize: 13 }}>View Details</Link>
                      </>
                    )}
                    <button
                      onClick={() => togglePlugins(e.id)}
                      style={{ padding: '4px 12px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                    >
                      {isExpanded ? 'Hide Plugins' : 'Show Plugins'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(e.id)}
                      style={{ marginLeft: 'auto', padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                    >
                      Delete
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: 12 }}>
                      {loading ? (
                        <p style={{ fontSize: 13, color: '#6b7280' }}>Loading plugins...</p>
                      ) : plugins.length === 0 ? (
                        <p style={{ fontSize: 13, color: '#9ca3af' }}>No plugin details available.</p>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: '#f9fafb' }}>
                              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Plugin</th>
                              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Version</th>
                              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Marketplace</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plugins.map(p => (
                              <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '6px 10px' }}>{p.name}</td>
                                <td style={{ padding: '6px 10px', color: '#6b7280' }}>{p.version ?? '—'}</td>
                                <td style={{ padding: '6px 10px', color: '#6b7280' }}>
                                  {p.marketplace_name}
                                  {p.marketplace_branch && (
                                    <span style={{ marginLeft: 6, fontSize: 11, background: '#e0e7ff', color: '#3730a3', borderRadius: 4, padding: '1px 6px' }}>
                                      {p.marketplace_branch}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
                    Created {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
        )
      }

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Export"
        message="Are you sure you want to delete this export? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
