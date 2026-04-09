import { Router } from 'express'
import type { Db } from '../db.js'

export function tasksRouter(db: Db) {
  const router = Router()
  router.get('/', (_req, res) => {
    const tasks = db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all()
    res.json(tasks)
  })
  return router
}
