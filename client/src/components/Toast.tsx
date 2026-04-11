import { createContext, useCallback, useContext, useState } from 'react'

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  type: ToastType
  text: string
}

interface ToastContextValue {
  showToast: (type: ToastType, text: string) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const showToast = useCallback((type: ToastType, text: string) => {
    const id = nextId++
    setToasts(prev => [...prev, { id, type, text }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              background: t.type === 'success' ? '#16a34a' : '#dc2626',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 14,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              minWidth: 220,
              maxWidth: 360,
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
