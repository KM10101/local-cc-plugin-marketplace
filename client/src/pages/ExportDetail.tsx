import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import type { Export } from '../types'

interface EnrichedPlugin {
  id: string
  name: string
  version: string | null
  author: string | null
  description: string | null
  status: string
  marketplace_id: string
  marketplace_name: string
  marketplace_branch: string
}

export default function ExportDetail() {
  const { id } = useParams<{ id: string }>()
  const [exp, setExp] = useState<Export | null>(null)
  const [plugins, setPlugins] = useState<EnrichedPlugin[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.exports.get(id).then((e) => {
      setExp(e)
      setPlugins(e.plugins ?? [])
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

      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '24px 0 12px' }}>
        Included Plugins ({plugins.length})
      </h2>
      {plugins.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 600 }}>Plugin</th>
              <th style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 600 }}>Version</th>
              <th style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 600 }}>Author</th>
              <th style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 600 }}>Marketplace</th>
              <th style={{ padding: '8px 12px', color: '#9ca3af', fontWeight: 600 }}>Branch</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ fontWeight: 700 }}>{p.name}</span>
                  {p.description && (
                    <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>{p.description}</div>
                  )}
                </td>
                <td style={{ padding: '10px 12px', color: '#d1d5db' }}>{p.version ?? '—'}</td>
                <td style={{ padding: '10px 12px', color: '#d1d5db' }}>{p.author ?? '—'}</td>
                <td style={{ padding: '10px 12px', color: '#d1d5db' }}>{p.marketplace_name}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    background: '#1e3a5f',
                    color: '#60a5fa',
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}>
                    {p.marketplace_branch}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>No plugin details available.</p>
      )}
    </div>
  )
}
