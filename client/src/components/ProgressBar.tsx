export function ProgressBar({ value, message }: { value: number; message?: string | null }) {
  return (
    <div>
      <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: '#2563eb',
          width: `${Math.min(100, Math.max(0, value))}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
      {message && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{message}</p>}
    </div>
  )
}
