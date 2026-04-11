import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createDb } from './db.js'
import { TaskScheduler } from './services/task-scheduler.js'
import { persistCloneResults } from './services/marketplace-service.js'
import { marketplacesRouter } from './routes/marketplaces.js'
import { pluginsRouter } from './routes/plugins.js'
import { tasksRouter } from './routes/tasks.js'
import { exportsRouter } from './routes/exports.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export { REPOS_DIR, EXPORTS_DIR } from './config.js'

export function createApp(dbPath = join(process.cwd(), 'data', 'db.sqlite')) {
  const db = createDb(dbPath)
  const scheduler = new TaskScheduler(db)

  scheduler.onMarketplaceDone = async (task, msg) => {
    try {
      await persistCloneResults(db, task.marketplace_id!, msg.gitSha, msg.plugins)
    } catch (err: any) {
      db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(task.marketplace_id)
    }
  }

  const app = express()

  app.use(cors())
  app.use(express.json())

  app.use('/api/marketplaces', marketplacesRouter(db, scheduler))
  app.use('/api/plugins', pluginsRouter(db))
  app.use('/api/tasks', tasksRouter(db, scheduler))
  app.use('/api/exports', exportsRouter(db))

  // Serve built client in production
  const clientDist = join(__dirname, '..', 'client')
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'))
  })

  return app
}

// Start server when run directly
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const app = createApp()
  const PORT = process.env.PORT ?? 3001
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}
