import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Marketplace, Plugin } from '../types'
import { SearchInput } from '../components/SearchInput'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'

export default function ExportNew() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [plugins, setPlugins] = useState<Record<string, Plugin[]>>({})
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedBranch, setSelectedBranch] = useState<Record<string, string>>({})
  const [pluginSearch, setPluginSearch] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const nav = useNavigate()
  const { showToast } = useToast()

  useEffect(() => {
    api.marketplaces.list().then(async (list: Marketplace[]) => {
      const readyList = list.filter(m => m.status === 'ready')
      setMarketplaces(readyList)

      // Default branch selection: first marketplace per repo_url
      const branchDefaults: Record<string, string> = {}
      for (const m of readyList) {
        if (!branchDefaults[m.repo_url]) {
          branchDefaults[m.repo_url] = m.id
        }
      }
      setSelectedBranch(branchDefaults)

      // Load plugins for all ready marketplaces
      const pluginMap: Record<string, Plugin[]> = {}
      for (const m of readyList) {
        pluginMap[m.id] = await api.marketplaces.plugins(m.id)
      }
      setPlugins(pluginMap)
    }).catch((e: any) => showToast('error', e.message ?? 'Failed to load marketplaces'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Group marketplaces by repo_url
  const repoGroups = useMemo(() => {
    const groups: Record<string, Marketplace[]> = {}
    for (const m of marketplaces) {
      if (!groups[m.repo_url]) groups[m.repo_url] = []
      groups[m.repo_url].push(m)
    }
    return groups
  }, [marketplaces])

  // The visible marketplaces (one per repo, based on branch selection)
  const visibleMarketplaces = useMemo(() => {
    const result: Marketplace[] = []
    for (const [repoUrl, group] of Object.entries(repoGroups)) {
      const selectedId = selectedBranch[repoUrl]
      const chosen = group.find(m => m.id === selectedId) ?? group[0]
      if (chosen) result.push(chosen)
    }
    return result
  }, [repoGroups, selectedBranch])

  // Filter plugins by search
  const filteredPlugins = useMemo(() => {
    if (!pluginSearch.trim()) return plugins
    const q = pluginSearch.toLowerCase()
    const result: Record<string, Plugin[]> = {}
    for (const [mId, pList] of Object.entries(plugins)) {
      result[mId] = pList.filter(p => p.name.toLowerCase().includes(q))
    }
    return result
  }, [plugins, pluginSearch])

  // Auto-expand marketplaces with matching plugins when searching
  useEffect(() => {
    if (!pluginSearch.trim()) return
    const toExpand = new Set<string>()
    for (const m of visibleMarketplaces) {
      const fp = filteredPlugins[m.id]
      if (fp && fp.length > 0) toExpand.add(m.id)
    }
    setExpanded(prev => {
      const next = new Set(prev)
      for (const id of toExpand) next.add(id)
      return next
    })
  }, [pluginSearch, filteredPlugins, visibleMarketplaces])

  function handleBranchChange(repoUrl: string, newMarketplaceId: string) {
    setSelectedBranch(prev => ({ ...prev, [repoUrl]: newMarketplaceId }))
    // Clear selections for all marketplaces in this repo group
    const group = repoGroups[repoUrl] || []
    setSelected(prev => {
      const next = { ...prev }
      for (const m of group) {
        delete next[m.id]
      }
      return next
    })
  }

  function toggleExpand(mId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(mId)) next.delete(mId)
      else next.add(mId)
      return next
    })
  }

  function toggleMarketplace(mId: string) {
    setSelected(prev => {
      const next = { ...prev }
      const mPlugins = (plugins[mId] || []).filter(p => p.status === 'ready')
      if (next[mId] && next[mId].size > 0) {
        delete next[mId]
      } else {
        next[mId] = new Set(mPlugins.map(p => p.id))
      }
      return next
    })
  }

  function togglePlugin(mId: string, pId: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (!next[mId]) next[mId] = new Set()
      else next[mId] = new Set(next[mId])
      if (next[mId].has(pId)) next[mId].delete(pId)
      else next[mId].add(pId)
      if (next[mId].size === 0) delete next[mId]
      return next
    })
  }

  function totalPlugins() {
    return Object.values(selected).reduce((s, set) => s + set.size, 0)
  }

  function selectedMarketplaceCount() {
    return Object.keys(selected).filter(k => selected[k].size > 0).length
  }

  async function handleSubmit() {
    setSubmitting(true)
    const content: Record<string, string[]> = {}
    for (const [mId, pSet] of Object.entries(selected)) {
      if (pSet.size > 0) content[mId] = Array.from(pSet)
    }
    try {
      await api.exports.create(name, content)
      nav('/export')
    } catch (e: any) {
      showToast('error', e.message ?? 'Failed to create export')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>New Export</h1>

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Select Plugins</h2>
            <SearchInput
              placeholder="Search plugins..."
              value={pluginSearch}
              onChange={setPluginSearch}
            />
          </div>

          {visibleMarketplaces.length === 0
            ? <p style={{ color: '#9ca3af' }}>No ready marketplaces available.</p>
            : visibleMarketplaces.map(m => {
              const mPlugins = filteredPlugins[m.id] || []
              const allPlugins = plugins[m.id] || []
              const readyPlugins = allPlugins.filter(p => p.status === 'ready')
              const mSelected = selected[m.id]
              const selectedReadyCount = mSelected ? [...mSelected].filter(id => readyPlugins.some(p => p.id === id)).length : 0
              const allReadyChecked = readyPlugins.length > 0 && selectedReadyCount === readyPlugins.length
              const isExpanded = expanded.has(m.id)
              const repoGroup = repoGroups[m.repo_url] || []
              const hasMultipleBranches = repoGroup.length > 1

              return (
                <div key={m.id} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Header row */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                    background: '#f9fafb', cursor: 'pointer', userSelect: 'none',
                  }}>
                    <span
                      onClick={() => toggleExpand(m.id)}
                      style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}
                    >
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedReadyCount > 0}
                      ref={el => { if (el) el.indeterminate = selectedReadyCount > 0 && !allReadyChecked }}
                      onChange={(e) => { e.stopPropagation(); toggleMarketplace(m.id) }}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      onClick={() => toggleExpand(m.id)}
                      style={{ fontWeight: 600, flex: 1 }}
                    >
                      {m.name}
                      <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8, fontSize: 13 }}>
                        ({allPlugins.length} plugin{allPlugins.length !== 1 ? 's' : ''})
                      </span>
                    </span>
                    {hasMultipleBranches && (
                      <select
                        value={selectedBranch[m.repo_url] || m.id}
                        onChange={e => { e.stopPropagation(); handleBranchChange(m.repo_url, e.target.value) }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db',
                          fontSize: 13, background: '#fff', flexShrink: 0,
                        }}
                      >
                        {repoGroup.map(rm => (
                          <option key={rm.id} value={rm.id}>{rm.branch}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Plugin list (collapsible) */}
                  {isExpanded && (
                    <div style={{ padding: '8px 12px 12px 44px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {mPlugins.length === 0 && (
                        <span style={{ color: '#9ca3af', fontSize: 13 }}>
                          {pluginSearch ? 'No plugins match search.' : 'No plugins.'}
                        </span>
                      )}
                      {mPlugins.map(p => {
                        const isReady = p.status === 'ready'
                        return (
                          <label
                            key={p.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              cursor: isReady ? 'pointer' : 'default',
                              fontSize: 14,
                              opacity: isReady ? 1 : 0.5,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!!mSelected?.has(p.id)}
                              onChange={() => togglePlugin(m.id, p.id)}
                              disabled={!isReady}
                            />
                            {p.name}{p.version ? ` v${p.version}` : ''}
                            {!isReady && (
                              <StatusBadge status={p.status} />
                            )}
                            {isReady && p.description && (
                              <span style={{ color: '#9ca3af', fontSize: 12 }}>
                                &mdash; {p.description.slice(0, 60)}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          }
        </div>

        {/* Right: summary */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={{
            border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
            background: '#f9fafb', position: 'sticky', top: 24,
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Summary</h2>
            <p style={{ margin: '4px 0', fontSize: 14 }}>
              {selectedMarketplaceCount()} marketplace{selectedMarketplaceCount() !== 1 ? 's' : ''}
            </p>
            <p style={{ margin: '4px 0', fontSize: 14 }}>
              {totalPlugins()} plugin{totalPlugins() !== 1 ? 's' : ''}
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting || totalPlugins() === 0}
              style={{
                marginTop: 16, width: '100%', padding: '8px 0',
                background: totalPlugins() === 0 ? '#e5e7eb' : '#2563eb',
                color: totalPlugins() === 0 ? '#9ca3af' : '#fff',
                border: 'none', borderRadius: 6,
                cursor: totalPlugins() === 0 ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              {submitting ? 'Creating\u2026' : 'Start Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
