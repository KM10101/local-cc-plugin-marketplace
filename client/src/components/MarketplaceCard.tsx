import { useNavigate } from 'react-router-dom'
import { StatusBadge } from './StatusBadge'
import type { Marketplace } from '../types'

interface Props {
  marketplace: Marketplace
  onDelete: (id: string) => void
  onRefresh: (id: string) => void
}

export function MarketplaceCard({ marketplace: m, onDelete, onRefresh }: Props) {
  const nav = useNavigate()
  return (
    <div
      onClick={() => nav(`/marketplace/${m.id}`)}
      style={{
        border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, cursor: 'pointer',
        background: '#fff', transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontSize: 16 }}>{m.name}</strong>
          {m.owner && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 13 }}>by {m.owner}</span>}
        </div>
        <StatusBadge status={m.status} />
      </div>
      {m.description && <p style={{ color: '#4b5563', fontSize: 14, margin: '8px 0 4px' }}>{m.description}</p>}
      <p style={{ color: '#9ca3af', fontSize: 12, margin: '4px 0' }}>{m.repo_url}</p>
      {m.last_updated && (
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '2px 0' }}>
          Updated {new Date(m.last_updated).toLocaleDateString()}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{m.plugin_count ?? 0} plugins</span>
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onRefresh(m.id)} style={btnStyle('#dbeafe', '#1d4ed8')}>Refresh</button>
          <button onClick={() => onDelete(m.id)} style={btnStyle('#fee2e2', '#dc2626')}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(bg: string, color: string) {
  return { background: bg, color, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }
}
