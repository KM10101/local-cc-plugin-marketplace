type Status = 'pending' | 'cloning' | 'ready' | 'error' | 'running' | 'completed' | 'failed' | 'packaging'

const colors: Record<Status, { bg: string; text: string }> = {
  pending:   { bg: '#f3f4f6', text: '#6b7280' },
  cloning:   { bg: '#dbeafe', text: '#1d4ed8' },
  running:   { bg: '#dbeafe', text: '#1d4ed8' },
  packaging: { bg: '#dbeafe', text: '#1d4ed8' },
  ready:     { bg: '#dcfce7', text: '#15803d' },
  completed: { bg: '#dcfce7', text: '#15803d' },
  error:     { bg: '#fee2e2', text: '#dc2626' },
  failed:    { bg: '#fee2e2', text: '#dc2626' },
}

export function StatusBadge({ status }: { status: string }) {
  const color = colors[status as Status] ?? { bg: '#f3f4f6', text: '#6b7280' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      backgroundColor: color.bg, color: color.text,
    }}>
      {status}
    </span>
  )
}
