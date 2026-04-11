import { Router } from 'express'
import type { Db } from '../db.js'
import type { TaskScheduler } from '../services/task-scheduler.js'
import type { Task } from '../types.js'

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed'
}

export function tasksRouter(db: Db, scheduler: TaskScheduler) {
  const router = Router()

  router.get('/', (req, res) => {
    const search = req.query.search as string | undefined
    let sql = `SELECT * FROM tasks WHERE parent_task_id IS NULL`
    const params: any[] = []
    if (search) {
      sql += ` AND repo_url LIKE ?`
      params.push(`%${search}%`)
    }
    sql += ` ORDER BY created_at DESC`
    const parents = db.prepare(sql).all(...params) as Task[]

    const withChildren = parents.map(parent => {
      const children = db.prepare(
        `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC`
      ).all(parent.id) as Task[]
      return { ...parent, children }
    })
    res.json(withChildren)
  })

  router.post('/:id/stop', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id) as Task | undefined
    if (!task) return res.status(404).json({ error: 'Task not found' })
    scheduler.stopTask(req.params.id)
    res.json({ ok: true })
  })

  router.post('/:id/resume', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id) as Task | undefined
    if (!task) return res.status(404).json({ error: 'Task not found' })
    scheduler.resumeTask(req.params.id)
    res.json({ ok: true })
  })

  router.delete('/:id', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id) as Task | undefined
    if (!task) return res.status(404).json({ error: 'Task not found' })
    scheduler.deleteTask(req.params.id)
    res.status(204).send()
  })

  router.get('/:id/events', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as Task | undefined
    if (!task) return res.status(404).json({ error: 'Task not found' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    // Build payload with children if this is a parent task
    const buildPayload = (t: Task) => {
      if (!t.parent_task_id) {
        const children = db.prepare(
          `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC`
        ).all(t.id) as Task[]
        return { ...t, children }
      }
      return t
    }

    // Send current state immediately (reuse already-fetched task)
    send(buildPayload(task))

    if (isTerminal(task.status)) {
      res.end()
      return
    }

    const interval = setInterval(() => {
      const updated = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as Task | undefined
      if (!updated) { clearInterval(interval); res.end(); return }
      send(buildPayload(updated))
      if (isTerminal(updated.status)) {
        clearInterval(interval)
        res.end()
      }
    }, 500)

    req.on('close', () => clearInterval(interval))
  })

  return router
}
