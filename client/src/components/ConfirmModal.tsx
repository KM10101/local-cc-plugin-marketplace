import { useEffect } from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: 24, maxWidth: 400, width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{title}</h3>
        <p style={{ color: '#4b5563', fontSize: 14, margin: '0 0 20px' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              background: '#fff', color: '#374151', border: '1px solid #d1d5db',
              borderRadius: 6, padding: '6px 16px', fontSize: 14, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 6, padding: '6px 16px', fontSize: 14, cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
