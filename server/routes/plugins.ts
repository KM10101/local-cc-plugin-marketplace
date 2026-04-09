import { Router } from 'express'
import type { Db } from '../db.js'

export function pluginsRouter(db: Db) {
  const router = Router()
  router.get('/:id', (req, res) => {
    const plugin = db.prepare(`SELECT * FROM plugins WHERE id=?`).get(req.params.id)
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' })
    res.json(plugin)
  })
  return router
}
