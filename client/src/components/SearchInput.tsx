import { useEffect, useRef, useState } from 'react'

interface Props {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  debounceMs?: number
}

export function SearchInput({ placeholder, value, onChange, debounceMs = 300 }: Props) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if parent resets value externally
  useEffect(() => {
    setLocal(value)
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLocal(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(v), debounceMs)
  }

  const handleClear = () => {
    setLocal('')
    if (timer.current) clearTimeout(timer.current)
    onChange('')
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        style={{
          border: '1px solid #d1d5db',
          borderRadius: 6,
          padding: '6px 32px 6px 10px',
          fontSize: 14,
          outline: 'none',
          width: '100%',
        }}
      />
      {local && (
        <button
          onClick={handleClear}
          style={{
            position: 'absolute', right: 6,
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9ca3af', fontSize: 16, lineHeight: 1, padding: '0 2px',
          }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  )
}
