import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import type { Task } from '../types'

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const sources = useRef<Map<string, EventSource>>(new Map())

  useEffect(() => {
    api.tasks.list().then(list => {
      setTasks(list)
      list.filter((t: Task) => t.status === 'running').forEach(subscribeToTask)
    })
    return () => { sources.current.forEach(s => s.close()) }
  }, [])

  function subscribeToTask(task: Task) {
    if (sources.current.has(task.id)) return
    const es = api.tasks.events(task.id)
    sources.current.set(task.id, es)
    es.onmessage = (e) => {
      const updated = JSON.parse(e.data) as Task
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
      if (updated.status !== 'running') { es.close(); sources.current.delete(task.id) }
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>Download Tasks</h1>
      {tasks.length === 0
        ? <p style={{ color: '#9ca3af' }}>No tasks yet.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tasks.map(t => (
              <div key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{t.type.replace(/_/g, ' ')}</span>
                  <StatusBadge status={t.status} />
                </div>
                {t.status === 'running' && <ProgressBar value={t.progress} message={t.message} />}
                {t.status !== 'running' && t.message && (
                  <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{t.message}</p>
                )}
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '8px 0 0' }}>
                  Started {new Date(t.created_at).toLocaleString()}
                  {t.completed_at && ` · Finished ${new Date(t.completed_at).toLocaleString()}`}
                </p>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
