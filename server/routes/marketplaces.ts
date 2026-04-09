import { Router } from 'express'
import type { Db } from '../db.js'
import {
  addMarketplace,
  refreshMarketplace,
  deleteMarketplace,
  listMarketplaces,
  getMarketplacePlugins,
} from '../services/marketplace-service.js'
import { REPOS_DIR } from '../config.js'

export function marketplacesRouter(db: Db) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listMarketplaces(db))
  })

  router.post('/', (req, res) => {
    const { source_url } = req.body
    if (!source_url || typeof source_url !== 'string') {
      return res.status(400).json({ error: 'source_url is required' })
    }
    const result = addMarketplace(db, source_url, REPOS_DIR)
    res.status(202).json(result)
  })

  router.delete('/:id', (req, res) => {
    const deleted = deleteMarketplace(db, req.params.id, REPOS_DIR)
    if (!deleted) return res.status(404).json({ error: 'Marketplace not found' })
    res.status(204).send()
  })

  router.post('/:id/refresh', (req, res) => {
    const result = refreshMarketplace(db, req.params.id, REPOS_DIR)
    if (!result) return res.status(404).json({ error: 'Marketplace not found' })
    res.status(202).json(result)
  })

  router.get('/:id/plugins', (req, res) => {
    const plugins = getMarketplacePlugins(db, req.params.id)
    res.json(plugins)
  })

  return router
}
