import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Marketplace, Plugin } from '../types'

export default function ExportNew() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [plugins, setPlugins] = useState<Record<string, Plugin[]>>({})
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nav = useNavigate()

  useEffect(() => {
    api.marketplaces.list().then(async list => {
      const readyList = list.filter((m: Marketplace) => m.status === 'ready')
      setMarketplaces(readyList)
      const pluginMap: Record<string, Plugin[]> = {}
      for (const m of readyList) {
        pluginMap[m.id] = await api.marketplaces.plugins(m.id)
      }
      setPlugins(pluginMap)
    }).catch((e: any) => setError(e.message))
  }, [])

  function toggleMarketplace(mId: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[mId]) {
        delete next[mId]
      } else {
        next[mId] = new Set((plugins[mId] || []).map((p: Plugin) => p.id))
      }
      return next
    })
  }

  function togglePlugin(mId: string, pId: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (!next[mId]) next[mId] = new Set()
      if (next[mId].has(pId)) next[mId].delete(pId)
      else next[mId].add(pId)
      if (next[mId].size === 0) delete next[mId]
      return next
    })
  }

  function totalPlugins() {
    return Object.values(selected).reduce((s, set) => s + set.size, 0)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    const content: Record<string, string[]> = {}
    for (const [mId, pSet] of Object.entries(selected)) {
      content[mId] = Array.from(pSet)
    }
    try {
      await api.exports.create(name, content)
      nav('/export')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>New Export</h1>

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>Error: {error}</p>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Export Name (optional)</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. team-plugins-2026-04"
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, width: 320 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Left: tree selector */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Select Plugins</h2>
          {marketplaces.length === 0
            ? <p style={{ color: '#9ca3af' }}>No ready marketplaces available.</p>
            : marketplaces.map(m => {
              const mPlugins = plugins[m.id] || []
              const mSelected = selected[m.id]
              const allChecked = mSelected?.size === mPlugins.length
              return (
                <div key={m.id} style={{ marginBottom: 16, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={!!mSelected && mSelected.size > 0}
                      ref={el => { if (el) el.indeterminate = !!mSelected && mSelected.size > 0 && !allChecked }}
                      onChange={() => toggleMarketplace(m.id)} />
                    {m.name} ({mPlugins.length} plugins)
                  </label>
                  <div style={{ marginTop: 8, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {mPlugins.map((p: Plugin) => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={!!mSelected?.has(p.id)} onChange={() => togglePlugin(m.id, p.id)} />
                        {p.name}{p.version ? ` v${p.version}` : ''}
                        {p.description && <span style={{ color: '#9ca3af', fontSize: 12 }}>— {p.description.slice(0, 60)}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })
          }
        </div>

        {/* Right: summary */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#f9fafb', position: 'sticky', top: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Summary</h2>
            <p style={{ margin: '4px 0', fontSize: 14 }}>{Object.keys(selected).length} marketplace{Object.keys(selected).length !== 1 ? 's' : ''}</p>
            <p style={{ margin: '4px 0', fontSize: 14 }}>{totalPlugins()} plugin{totalPlugins() !== 1 ? 's' : ''}</p>
            <button
              onClick={handleSubmit}
              disabled={submitting || totalPlugins() === 0}
              style={{
                marginTop: 16, width: '100%', padding: '8px 0',
                background: totalPlugins() === 0 ? '#e5e7eb' : '#2563eb',
                color: totalPlugins() === 0 ? '#9ca3af' : '#fff',
                border: 'none', borderRadius: 6, cursor: totalPlugins() === 0 ? 'default' : 'pointer', fontWeight: 600,
              }}>
              {submitting ? 'Creating…' : 'Start Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
