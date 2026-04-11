import { Router } from 'express'
import type { Db } from '../db.js'
import type { TaskScheduler } from '../services/task-scheduler.js'
import {
  addMarketplace,
  refreshMarketplace,
  deleteMarketplace,
  listMarketplaces,
  getMarketplace,
  getMarketplacePlugins,
  getRepoBranches,
  ConflictError,
} from '../services/marketplace-service.js'
import { REPOS_DIR } from '../config.js'

export function marketplacesRouter(db: Db, scheduler: TaskScheduler) {
  const router = Router()

  router.get('/', (req, res) => {
    const search = req.query.search as string | undefined
    res.json(listMarketplaces(db, search))
  })

  // MUST be before /:id to avoid matching "repo-branches" as an id
  router.get('/repo-branches', (req, res) => {
    const repoUrl = req.query.repo_url as string | undefined
    if (!repoUrl) return res.status(400).json({ error: 'repo_url query parameter is required' })
    res.json(getRepoBranches(db, repoUrl))
  })

  router.get('/:id', (req, res) => {
    const marketplace = getMarketplace(db, req.params.id)
    if (!marketplace) return res.status(404).json({ error: 'Not found' })
    res.json(marketplace)
  })

  router.post('/', (req, res) => {
    const repoUrl = req.body.repo_url || req.body.source_url
    if (!repoUrl || typeof repoUrl !== 'string') {
      return res.status(400).json({ error: 'repo_url is required' })
    }
    const branch = req.body.branch as string | undefined
    try {
      const result = addMarketplace(db, scheduler, { repoUrl, branch, reposDir: REPOS_DIR })
      res.status(202).json(result)
    } catch (err: any) {
      if (err instanceof ConflictError) return res.status(409).json({ error: err.message })
      throw err
    }
  })

  router.post('/:id/branches', (req, res) => {
    const marketplace = getMarketplace(db, req.params.id)
    if (!marketplace) return res.status(404).json({ error: 'Marketplace not found' })
    const branch = req.body.branch as string | undefined
    if (!branch || typeof branch !== 'string') {
      return res.status(400).json({ error: 'branch is required' })
    }
    try {
      const result = addMarketplace(db, scheduler, { repoUrl: marketplace.repo_url, branch, reposDir: REPOS_DIR })
      res.status(202).json(result)
    } catch (err: any) {
      if (err instanceof ConflictError) return res.status(409).json({ error: err.message })
      throw err
    }
  })

  router.delete('/:id', (req, res) => {
    const deleted = deleteMarketplace(db, req.params.id, REPOS_DIR)
    if (!deleted) return res.status(404).json({ error: 'Marketplace not found' })
    res.status(204).send()
  })

  router.post('/:id/refresh', (req, res) => {
    try {
      const result = refreshMarketplace(db, scheduler, req.params.id, REPOS_DIR)
      if (!result) return res.status(404).json({ error: 'Marketplace not found' })
      res.status(202).json(result)
    } catch (err: any) {
      if (err instanceof ConflictError) return res.status(409).json({ error: err.message })
      throw err
    }
  })

  router.get('/:id/plugins', (req, res) => {
    const search = req.query.search as string | undefined
    const plugins = getMarketplacePlugins(db, req.params.id, search)
    res.json(plugins)
  })

  return router
}
