import { Router } from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import { EXPORTS_DIR } from '../config.js'
import type { ExportWorkerMessage } from '../workers/export-worker.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MAX_EXPORTS = 20

function now() { return new Date().toISOString() }
function uuid() { return crypto.randomUUID() }

export function exportsRouter(db: Db) {
  const router = Router()

  router.get('/', (req, res) => {
    const search = req.query.search as string | undefined
    const allExports = db.prepare(`SELECT * FROM exports ORDER BY created_at DESC`).all() as any[]

    if (!search) {
      return res.json(allExports)
    }

    const matching = allExports.filter(exp => {
      let content: Record<string, string[]>
      try {
        content = JSON.parse(exp.selected_content)
      } catch {
        return false
      }
      for (const pluginIds of Object.values(content)) {
        for (const pid of pluginIds) {
          const plugin = db.prepare(`SELECT id FROM plugins WHERE id=? AND name LIKE ?`).get(pid, `%${search}%`)
          if (plugin) return true
        }
      }
      return false
    })

    res.json(matching)
  })

  router.get('/:id', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })

    let content: Record<string, string[]>
    try {
      content = JSON.parse(exp.selected_content)
    } catch {
      content = {}
    }

    const plugins: any[] = []
    for (const [mId, pluginIds] of Object.entries(content)) {
      const marketplace = db.prepare(`SELECT name, branch, repo_url FROM marketplaces WHERE id = ?`).get(mId) as any
      for (const pid of pluginIds as string[]) {
        const plugin = db.prepare(`SELECT id, name, version, author, description, status FROM plugins WHERE id = ?`).get(pid) as any
        if (plugin) {
          plugins.push({
            ...plugin,
            marketplace_id: mId,
            marketplace_name: marketplace?.name ?? 'Unknown',
            marketplace_branch: marketplace?.branch ?? 'unknown',
          })
        }
      }
    }

    res.json({ ...exp, plugins })
  })

  router.post('/', (req, res) => {
    // selected_content: { [marketplaceId]: pluginId[] }
    const { name, selected_content } = req.body
    if (!selected_content || typeof selected_content !== 'object') {
      return res.status(400).json({ error: 'selected_content is required' })
    }

    // Enforce 20-record limit: delete oldest if needed
    const count = (db.prepare(`SELECT COUNT(*) as c FROM exports`).get() as any).c
    if (count >= MAX_EXPORTS) {
      const oldest = db.prepare(`SELECT id, zip_path FROM exports ORDER BY created_at ASC LIMIT 1`).get() as any
      if (oldest) {
        if (oldest.zip_path && existsSync(oldest.zip_path)) {
          rm(oldest.zip_path, { force: true }).catch(() => {})
        }
        db.prepare(`DELETE FROM exports WHERE id=?`).run(oldest.id)
      }
    }

    const exportId = uuid()
    const exportName = (name as string) || `export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`

    db.prepare(`INSERT INTO exports (id, name, status, progress, selected_content, created_at)
      VALUES (?, ?, 'packaging', 0, ?, ?)`
    ).run(exportId, exportName, JSON.stringify(selected_content), now())

    // Build marketplaces input for worker
    const marketplacesInput = Object.entries(selected_content as Record<string, string[]>).flatMap(([mId, pluginIds]) => {
      const marketplace = db.prepare(`SELECT * FROM marketplaces WHERE id=?`).get(mId) as any
      if (!marketplace) return []
      const plugins = pluginIds.map(pid => db.prepare(`SELECT * FROM plugins WHERE id=?`).get(pid) as any).filter(Boolean)
      return [{
        marketplaceLocalPath: marketplace.local_path,
        marketplaceId: mId,
        marketplaceName: marketplace.name,
        selectedPlugins: plugins.map((p: any) => ({
          name: p.name,
          source_type: p.source_type,
          local_path: p.local_path,
        })),
      }]
    })

    const workerJsPath = join(__dirname, '..', 'workers', 'export-worker.js')
    const workerTsPath = workerJsPath.replace(/\.js$/, '.ts')
    const useTs = !existsSync(workerJsPath) && existsSync(workerTsPath)
    const workerPath = useTs ? workerTsPath : workerJsPath
    const worker = new Worker(workerPath, {
      workerData: { exportId, exportName, marketplaces: marketplacesInput, exportsDir: EXPORTS_DIR },
      execArgv: useTs ? ['--import', 'tsx/esm'] : [],
    })

    worker.on('message', (msg: ExportWorkerMessage) => {
      if (msg.type === 'progress') {
        db.prepare(`UPDATE exports SET progress=?, message=? WHERE id=?`)
          .run(msg.progress, msg.message, exportId)
      } else if (msg.type === 'done') {
        db.prepare(`UPDATE exports SET status='ready', progress=100, zip_path=?, zip_size=?, completed_at=? WHERE id=?`)
          .run(msg.zipPath, msg.zipSize, now(), exportId)
      } else if (msg.type === 'error') {
        db.prepare(`UPDATE exports SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(msg.message, now(), exportId)
      }
    })

    worker.on('error', (err) => {
      db.prepare(`UPDATE exports SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run(err.message, now(), exportId)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        db.prepare(`UPDATE exports SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(`Worker exited with code ${code}`, now(), exportId)
      }
    })

    res.status(202).json({ export_id: exportId })
  })

  router.get('/:id/events', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    send(exp)

    if (exp.status !== 'packaging') { res.end(); return }

    const interval = setInterval(() => {
      const updated = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
      if (!updated) { clearInterval(interval); res.end(); return }
      send(updated)
      if (updated.status !== 'packaging') { clearInterval(interval); res.end() }
    }, 500)

    req.on('close', () => clearInterval(interval))
  })

  router.get('/:id/download', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })
    if (exp.status !== 'ready' || !exp.zip_path) {
      return res.status(409).json({ error: 'Export not ready' })
    }
    res.download(exp.zip_path, `${exp.name}.zip`)
  })

  router.delete('/:id', (req, res) => {
    const exp = db.prepare(`SELECT * FROM exports WHERE id=?`).get(req.params.id) as any
    if (!exp) return res.status(404).json({ error: 'Export not found' })
    if (exp.zip_path && existsSync(exp.zip_path)) {
      rm(exp.zip_path, { force: true }).catch(() => {})
    }
    db.prepare(`DELETE FROM exports WHERE id=?`).run(req.params.id)
    res.status(204).send()
  })

  return router
}
