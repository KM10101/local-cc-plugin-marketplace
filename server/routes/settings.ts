import { Router } from 'express'
import type { Db } from '../db.js'
import { getProxyConfig, setProxyConfig, validateProxyUrl } from '../services/settings-service.js'

export function settingsRouter(db: Db) {
  const router = Router()

  router.get('/proxy', (_req, res) => {
    res.json(getProxyConfig(db))
  })

  router.put('/proxy', (req, res) => {
    const { enabled, url } = req.body ?? {}
    if (typeof enabled !== 'boolean' || typeof url !== 'string') {
      return res.status(400).json({ error: 'Request body must include { enabled: boolean, url: string }' })
    }

    if (enabled && url.trim().length > 0) {
      const err = validateProxyUrl(url)
      if (err) return res.status(400).json({ error: err })
    }

    setProxyConfig(db, { enabled, url })
    res.status(204).send()
  })

  return router
}
