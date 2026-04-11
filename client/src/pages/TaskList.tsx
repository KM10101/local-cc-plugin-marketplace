import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { SearchInput } from '../components/SearchInput'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import type { Task } from '../types'

function repoNameFromUrl(url: string | null): string {
  if (!url) return '(unknown repo)'
  try {
    const clean = url.replace(/\.git$/, '')
    const parts = clean.split('/')
    return parts[parts.length - 1] || clean
  } catch {
    return url
  }
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const sources = useRef<Map<string, EventSource>>(new Map())
  const { showToast } = useToast()

  useEffect(() => {
    api.tasks.list(search || undefined).then(list => {
      setTasks(list)
      list
        .filter((t: Task) => t.status === 'running' || t.status === 'queued')
        .forEach(subscribeToTask)
    }).catch((e: any) => setError(e.message))
    return () => { sources.current.forEach(s => s.close()) }
  }, [search])

  function subscribeToTask(task: Task) {
    if (sources.current.has(task.id)) return
    const es = api.tasks.events(task.id)
    sources.current.set(task.id, es)
    es.onmessage = (e) => {
      const updated = JSON.parse(e.data) as Task
      setTasks(prev => prev.map(t => {
        if (t.id === updated.id) return { ...t, ...updated }
        if (t.children) {
          return {
            ...t,
            children: t.children.map(c => c.id === updated.id ? { ...c, ...updated } : c),
          }
        }
        return t
      }))
      if (updated.status !== 'running' && updated.status !== 'queued') {
        es.close()
        sources.current.delete(task.id)
      }
    }
    es.onerror = () => { es.close(); sources.current.delete(task.id) }
  }

  async function handleStop(task: Task) {
    try {
      await api.tasks.stop(task.id)
      setTasks(prev => prev.map(t => {
        if (t.id === task.id) return { ...t, status: 'stopped' }
        if (t.children) {
          return {
            ...t,
            children: t.children.map(c => c.id === task.id ? { ...c, status: 'stopped' } : c),
          }
        }
        return t
      }))
      showToast('success', `Stopped task for ${repoNameFromUrl(task.repo_url)}`)
    } catch (e: any) {
      showToast('error', `Failed to stop: ${e.message}`)
    }
  }

  async function handleResume(task: Task) {
    try {
      await api.tasks.resume(task.id)
      setTasks(prev => prev.map(t => {
        if (t.id === task.id) {
          const resumed = { ...t, status: 'queued' as const }
          subscribeToTask(resumed)
          return resumed
        }
        if (t.children) {
          return {
            ...t,
            children: t.children.map(c => {
              if (c.id === task.id) {
                const resumed = { ...c, status: 'queued' as const }
                subscribeToTask(resumed)
                return resumed
              }
              return c
            }),
          }
        }
        return t
      }))
      showToast('success', `Resumed task for ${repoNameFromUrl(task.repo_url)}`)
    } catch (e: any) {
      showToast('error', `Failed to resume: ${e.message}`)
    }
  }

  async function handleDelete(task: Task) {
    setDeleteTarget(null)
    try {
      await api.tasks.delete(task.id)
      setTasks(prev => prev.filter(t => t.id !== task.id))
      showToast('success', `Deleted task for ${repoNameFromUrl(task.repo_url)}`)
    } catch (e: any) {
      showToast('error', `Failed to delete: ${e.message}`)
    }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderTaskRow(task: Task, isChild = false) {
    const isParent = !isChild
    const isExpandable = isParent && task.children && task.children.length > 0
    const isExpanded = expanded.has(task.id)
    const repoName = repoNameFromUrl(task.repo_url)

    return (
      <div
        key={task.id}
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: isChild ? 6 : 8,
          padding: isChild ? '10px 14px' : 16,
          background: isChild ? '#f9fafb' : '#fff',
          marginLeft: isChild ? 24 : 0,
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {isExpandable && (
            <button
              onClick={() => toggleExpand(task.id)}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: '#6b7280', padding: '0 2px', lineHeight: 1,
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!isExpandable && isParent && (
            <span style={{ display: 'inline-block', width: 18 }} />
          )}

          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {repoName}
            {task.branch && (
              <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6, fontSize: 12 }}>
                ({task.branch})
              </span>
            )}
            {isExpandable && (
              <span style={{
                marginLeft: 8, fontSize: 11, background: '#e5e7eb',
                borderRadius: 10, padding: '1px 7px', fontWeight: 500, color: '#374151',
              }}>
                {task.children!.length} subtask{task.children!.length !== 1 ? 's' : ''}
              </span>
            )}
          </span>

          <StatusBadge status={task.status} />

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(task.status === 'running' || task.status === 'queued') && (
              <button
                onClick={() => handleStop(task)}
                style={{
                  background: '#d97706', color: '#fff', border: 'none',
                  borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                Stop
              </button>
            )}
            {(task.status === 'stopped' || task.status === 'failed') && (
              <button
                onClick={() => handleResume(task)}
                style={{
                  background: '#2563eb', color: '#fff', border: 'none',
                  borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                Resume
              </button>
            )}
            {isParent && (
              <button
                onClick={() => setDeleteTarget(task)}
                style={{
                  background: '#dc2626', color: '#fff', border: 'none',
                  borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Progress / message */}
        {task.status === 'running' && (
          <div style={{ marginBottom: 6 }}>
            <ProgressBar value={task.progress} message={task.message ?? undefined} />
          </div>
        )}
        {task.status !== 'running' && task.message && (
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 6px' }}>{task.message}</p>
        )}

        {/* Timestamps */}
        <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
          Started {new Date(task.created_at).toLocaleString()}
          {task.completed_at && ` · Finished ${new Date(task.completed_at).toLocaleString()}`}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Download Tasks</h1>
        <SearchInput
          placeholder="Filter by repo name…"
          value={search}
          onChange={setSearch}
        />
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>Error: {error}</p>}

      {tasks.length === 0
        ? <p style={{ color: '#9ca3af' }}>{search ? 'No matching tasks.' : 'No tasks yet.'}</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tasks.map(task => (
              <div key={task.id}>
                {renderTaskRow(task)}
                {task.children && task.children.length > 0 && expanded.has(task.id) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {task.children.map(child => renderTaskRow(child, true))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Task"
        message={`Delete the task for "${repoNameFromUrl(deleteTarget?.repo_url ?? null)}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
