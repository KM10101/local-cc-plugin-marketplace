import { Router } from 'express'
import type { Db } from '../db.js'

export function exportsRouter(db: Db) {
  const router = Router()
  router.get('/', (_req, res) => {
    res.json(db.prepare(`SELECT * FROM exports ORDER BY created_at DESC`).all())
  })
  return router
}
