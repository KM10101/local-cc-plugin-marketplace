import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createDb } from './db.js'
import { marketplacesRouter } from './routes/marketplaces.js'
import { pluginsRouter } from './routes/plugins.js'
import { tasksRouter } from './routes/tasks.js'
import { exportsRouter } from './routes/exports.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const REPOS_DIR = join(process.cwd(), 'data', 'repos')
export const EXPORTS_DIR = join(process.cwd(), 'data', 'exports')

export function createApp(dbPath = join(process.cwd(), 'data', 'db.sqlite')) {
  const db = createDb(dbPath)
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.use('/api/marketplaces', marketplacesRouter(db))
  app.use('/api/plugins', pluginsRouter(db))
  app.use('/api/tasks', tasksRouter(db))
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
