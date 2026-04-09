import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { PluginCard } from '../components/PluginCard'
import { StatusBadge } from '../components/StatusBadge'
import type { Export, Plugin } from '../types'

export default function ExportDetail() {
  const { id } = useParams<{ id: string }>()
  const [exp, setExp] = useState<Export | null>(null)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.exports.get(id).then(async (e) => {
      setExp(e)
      const content: Record<string, string[]> = JSON.parse(e.selected_content)
      const allPlugins: Plugin[] = []
      for (const pluginIds of Object.values(content)) {
        for (const pid of pluginIds) {
          try { allPlugins.push(await api.plugins.get(pid)) } catch { /* skip deleted */ }
        }
      }
      setPlugins(allPlugins)
    }).catch((e: any) => setError(e.message))
  }, [id])

  if (error) return <p style={{ color: '#dc2626' }}>Error: {error}</p>
  if (!exp) return <p>Loading…</p>

  return (
    <div>
      <Link to="/export" style={{ color: '#2563eb', fontSize: 14 }}>← Exports</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '12px 0 4px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{exp.name}</h1>
        <StatusBadge status={exp.status} />
      </div>
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
        Created {new Date(exp.created_at).toLocaleString()}
        {exp.zip_size && ` · ${(exp.zip_size / 1024 / 1024).toFixed(1)} MB`}
      </p>
      {exp.status === 'ready' && (
        <a href={api.exports.downloadUrl(exp.id)} style={{ display: 'inline-block', marginBottom: 24 }}>
          <button style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Download Zip
          </button>
        </a>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Included Plugins ({plugins.length})
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {plugins.map(p => <PluginCard key={p.id} plugin={p} />)}
      </div>
    </div>
  )
}
