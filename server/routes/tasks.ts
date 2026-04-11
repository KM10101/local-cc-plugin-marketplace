import { Router } from 'express'
import type { Db } from '../db.js'
import type { TaskScheduler } from '../services/task-scheduler.js'
import type { Task, TaskStatus } from '../types.js'

function isTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed'
}

export function tasksRouter(db: Db, scheduler: TaskScheduler) {
  const router = Router()

  router.get('/', (_req, res) => {
    const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all()
    res.json(tasks)
  })

  router.get('/:id/events', (req, res) => {
    const task = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as Task | undefined
    if (!task) return res.status(404).json({ error: 'Task not found' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    // Send current state immediately (reuse already-fetched task)
    send(task)

    if (isTerminal(task.status)) {
      res.end()
      return
    }

    const interval = setInterval(() => {
      const updated = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(req.params.id) as Task | undefined
      if (!updated) { clearInterval(interval); res.end(); return }
      send(updated)
      if (isTerminal(updated.status)) {
        clearInterval(interval)
        res.end()
      }
    }, 500)

    req.on('close', () => clearInterval(interval))
  })

  return router
}
