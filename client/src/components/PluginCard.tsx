import { StatusBadge } from './StatusBadge'
import type { Plugin } from '../types'

export function PluginCard({ plugin: p }: { plugin: Plugin }) {
  const keywords: string[] = p.keywords ? JSON.parse(p.keywords) : []
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 15 }}>{p.name}</strong>
          {p.version && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 12 }}>v{p.version}</span>}
        </div>
        <StatusBadge status={p.status} />
      </div>
      {p.author && (
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0' }}>
          {p.author_url
            ? <a href={p.author_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{p.author}</a>
            : p.author}
        </p>
      )}
      {p.description && <p style={{ color: '#4b5563', fontSize: 14, margin: '8px 0' }}>{p.description}</p>}
      {keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {keywords.map((k: string) => (
            <span key={k} style={{ background: '#f3f4f6', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#374151' }}>{k}</span>
          ))}
        </div>
      )}
      {p.homepage && (
        <a href={p.homepage} target="_blank" rel="noreferrer"
           style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#2563eb' }}
           onClick={e => e.stopPropagation()}>
          Homepage →
        </a>
      )}
    </div>
  )
}
