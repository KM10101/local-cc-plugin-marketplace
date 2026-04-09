import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import type { Export } from '../types'

export default function ExportList() {
  const [exports, setExports] = useState<Export[]>([])
  const [error, setError] = useState<string | null>(null)
  const sources = useRef<Map<string, EventSource>>(new Map())
  const nav = useNavigate()

  useEffect(() => {
    load()
    return () => { sources.current.forEach(s => s.close()) }
  }, [])

  function load() {
    api.exports.list().then(list => {
      setExports(list)
      list.filter((e: Export) => e.status === 'packaging').forEach(subscribeToExport)
    }).catch((e: any) => setError(e.message))
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this export?')) return
    api.exports.delete(id)
      .then(() => setExports(prev => prev.filter(e => e.id !== id)))
      .catch((e: any) => setError(e.message))
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

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>Error: {error}</p>}

      {exports.length === 0
        ? <p style={{ color: '#9ca3af' }}>No exports yet. <Link to="/export/new" style={{ color: '#2563eb' }}>Create one</Link>.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {exports.map(e => {
              const content: Record<string, string[]> = JSON.parse(e.selected_content || '{}')
              const marketplaceCount = Object.keys(content).length
              const pluginCount = Object.values(content).flat().length
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
                    <button onClick={() => handleDelete(e.id)}
                      style={{ marginLeft: 'auto', padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      Delete
                    </button>
                  </div>

                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
                    Created {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}
