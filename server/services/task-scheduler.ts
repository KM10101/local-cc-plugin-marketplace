import { Worker } from 'worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import type { Task } from '../types.js'
import type { ClonePluginResult } from '../workers/clone-worker.js'
import type { MarketplacePluginEntry } from '../services/plugin-service.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function now() { return new Date().toISOString() }

export interface MarketplaceParsedData {
  gitSha: string
  localPlugins: ClonePluginResult[]
  pluginEntries: MarketplacePluginEntry[]
}

export class TaskScheduler {
  private db: Db
  private maxConcurrent: number
  private reposDir: string
  private workers: Map<string, Worker> = new Map()
  private parsedDataMap: Map<string, MarketplaceParsedData> = new Map()
  private childResultsMap: Map<string, ClonePluginResult[]> = new Map()

  /** Callback for marketplace-service to hook into when a marketplace clone finishes */
  onMarketplaceDone: ((task: Task, data: { gitSha: string; plugins: ClonePluginResult[]; pluginEntries: MarketplacePluginEntry[] }) => void) | null = null

  constructor(db: Db, options?: { maxConcurrent?: number; reposDir?: string }) {
    this.db = db
    this.maxConcurrent = options?.maxConcurrent ?? 20
    this.reposDir = options?.reposDir ?? join(process.cwd(), 'data', 'repos')
  }

  getRunningCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE status='running'`).get() as { cnt: number }
    return row.cnt
  }

  getNextQueued(): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE status='queued' ORDER BY created_at ASC LIMIT 1`).get() as Task | undefined
    return row ?? null
  }

  hasActiveTask(repoUrl: string, branch: string): boolean {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM tasks WHERE repo_url=? AND branch=? AND status IN ('running','queued')`
    ).get(repoUrl, branch) as { cnt: number }
    return row.cnt > 0
  }

  drainQueue(): void {
    while (this.getRunningCount() < this.maxConcurrent) {
      const next = this.getNextQueued()
      if (!next) break
      this.startWorker(next)
    }
  }

  enqueue(taskId: string): void {
    this.drainQueue()
  }

  stopTask(taskId: string): void {
    const task = this.db.prepare(`SELECT * FROM tasks WHERE id=?`).get(taskId) as Task | undefined
    if (!task) return

    // Check if this is a parent task (has children)
    const children = this.db.prepare(`SELECT * FROM tasks WHERE parent_task_id=?`).all(taskId) as Task[]

    if (children.length > 0) {
      // Stop all running/queued children
      for (const child of children) {
        if (child.status === 'running' || child.status === 'queued') {
          this.terminateWorker(child.id)
          this.db.prepare(`UPDATE tasks SET status='stopped' WHERE id=?`).run(child.id)
        }
      }
    }

    // Stop the task itself
    this.terminateWorker(taskId)
    this.db.prepare(`UPDATE tasks SET status='stopped' WHERE id=?`).run(taskId)
  }

  resumeTask(taskId: string): void {
    const task = this.db.prepare(`SELECT * FROM tasks WHERE id=?`).get(taskId) as Task | undefined
    if (!task) return

    // Check if this is a parent task (has children)
    const children = this.db.prepare(`SELECT * FROM tasks WHERE parent_task_id=?`).all(taskId) as Task[]

    if (children.length > 0) {
      // Resume stopped/failed children (not completed ones)
      for (const child of children) {
        if (child.status === 'stopped' || child.status === 'failed') {
          this.db.prepare(`UPDATE tasks SET status='queued' WHERE id=?`).run(child.id)
        }
      }
    }

    // Resume the task itself
    if (task.status === 'stopped' || task.status === 'failed') {
      this.db.prepare(`UPDATE tasks SET status='queued' WHERE id=?`).run(taskId)
    }

    this.drainQueue()
  }

  deleteTask(taskId: string): void {
    // Terminate workers for children first
    const children = this.db.prepare(`SELECT id FROM tasks WHERE parent_task_id=?`).all(taskId) as { id: string }[]
    for (const child of children) {
      this.terminateWorker(child.id)
    }
    this.terminateWorker(taskId)

    // Delete children then parent from DB
    this.db.prepare(`DELETE FROM tasks WHERE parent_task_id=?`).run(taskId)
    this.db.prepare(`DELETE FROM tasks WHERE id=?`).run(taskId)
  }

  updateParentStatus(parentTaskId: string | null): void {
    if (!parentTaskId) return

    const children = this.db.prepare(`SELECT * FROM tasks WHERE parent_task_id=?`).all(parentTaskId) as Task[]
    if (children.length === 0) return

    const parent = this.db.prepare(`SELECT * FROM tasks WHERE id=?`).get(parentTaskId) as Task | undefined
    if (!parent) return

    const hasRunning = children.some(c => c.status === 'running')
    const allCompleted = children.every(c => c.status === 'completed')
    const hasFailed = children.some(c => c.status === 'failed')
    const allStoppedOrQueued = children.every(c => c.status === 'stopped' || c.status === 'queued')

    const sumChildProgress = children.reduce((sum, c) => sum + c.progress, 0)
    const blended = Math.round((100 + sumChildProgress) / (1 + children.length))

    if (hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='running', progress=? WHERE id=?`).run(blended, parentTaskId)
    } else if (allCompleted) {
      this.db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`).run(now(), parentTaskId)
      this.triggerMarketplacePersistence(parentTaskId, parent)
    } else if (allStoppedOrQueued && !hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='stopped', progress=? WHERE id=?`).run(blended, parentTaskId)
    } else if (hasFailed && !hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='failed', progress=? WHERE id=?`).run(blended, parentTaskId)
      this.triggerMarketplacePersistence(parentTaskId, parent)
    } else {
      this.db.prepare(`UPDATE tasks SET status='running', progress=? WHERE id=?`).run(blended, parentTaskId)
    }
  }

  private triggerMarketplacePersistence(parentTaskId: string, parent: Task): void {
    if (parent.type !== 'clone_marketplace' || !this.onMarketplaceDone) return

    const parsedData = this.parsedDataMap.get(parentTaskId)
    if (!parsedData) return

    const childResults = this.getChildResults(parentTaskId)
    const allPlugins = [...parsedData.localPlugins, ...childResults]

    this.onMarketplaceDone(parent, {
      gitSha: parsedData.gitSha,
      plugins: allPlugins,
      pluginEntries: parsedData.pluginEntries,
    })

    this.cleanupParsedData(parentTaskId)
  }

  shutdown(): void {
    for (const [, worker] of this.workers) {
      try { worker.terminate() } catch { /* ignore */ }
    }
    this.workers.clear()
  }

  storeMarketplaceParsedData(parentTaskId: string, data: MarketplaceParsedData): void {
    this.parsedDataMap.set(parentTaskId, data)
  }

  getMarketplaceParsedData(parentTaskId: string): MarketplaceParsedData | null {
    return this.parsedDataMap.get(parentTaskId) ?? null
  }

  storeChildResult(parentTaskId: string, result: ClonePluginResult): void {
    const existing = this.childResultsMap.get(parentTaskId) ?? []
    existing.push(result)
    this.childResultsMap.set(parentTaskId, existing)
  }

  getChildResults(parentTaskId: string): ClonePluginResult[] {
    return this.childResultsMap.get(parentTaskId) ?? []
  }

  cleanupParsedData(parentTaskId: string): void {
    this.parsedDataMap.delete(parentTaskId)
    this.childResultsMap.delete(parentTaskId)
  }

  private terminateWorker(taskId: string): void {
    const worker = this.workers.get(taskId)
    if (worker) {
      try { worker.terminate() } catch { /* ignore */ }
      this.workers.delete(taskId)
    }
  }

  private startWorker(task: Task): void {
    // Update task status to running
    this.db.prepare(`UPDATE tasks SET status='running' WHERE id=?`).run(task.id)

    // Find the clone-worker file (.js first, fall back to .ts)
    const workerJsPath = join(__dirname, '..', 'workers', 'clone-worker.js')
    const workerTsPath = workerJsPath.replace(/\.js$/, '.ts')
    const useTs = !existsSync(workerJsPath) && existsSync(workerTsPath)
    const workerPath = useTs ? workerTsPath : workerJsPath

    // If neither file exists, fail the task immediately
    if (!existsSync(workerPath)) {
      this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run('Worker file not found', now(), task.id)
      this.updateParentStatus(task.parent_task_id)
      return
    }

    // Build workerData based on task type
    let workerDataPayload: Record<string, any>

    if (task.type === 'clone_marketplace') {
      workerDataPayload = {
        mode: 'marketplace',
        taskId: task.id,
        marketplaceId: task.marketplace_id,
        sourceUrl: task.repo_url,
        branch: task.branch,
        reposDir: this.reposDir,
      }
    } else {
      // clone_plugin
      let pluginDir: string
      if (task.parent_task_id && task.marketplace_id && task.plugin_name) {
        pluginDir = join(this.reposDir, 'plugins', task.marketplace_id, task.plugin_name)
      } else {
        const plugin = this.db.prepare(`SELECT local_path FROM plugins WHERE id=?`).get(task.plugin_id) as { local_path: string } | undefined
        pluginDir = plugin?.local_path ?? join(this.reposDir, 'plugins', task.plugin_id ?? 'unknown')
      }
      workerDataPayload = {
        mode: 'plugin',
        taskId: task.id,
        pluginId: task.plugin_id,
        sourceUrl: task.repo_url,
        branch: task.branch,
        pluginDir,
        pluginName: task.plugin_name,
        sourceFormat: task.source_format,
        subdirPath: task.subdir_path,
      }
    }

    const worker = new Worker(workerPath, {
      workerData: workerDataPayload,
      execArgv: useTs ? ['--import', 'tsx/esm'] : [],
    })

    this.workers.set(task.id, worker)

    worker.on('message', (msg: any) => {
      if (msg.type === 'progress') {
        this.db.prepare(`UPDATE tasks SET progress=?, message=? WHERE id=?`)
          .run(msg.progress, msg.message, task.id)
      } else if (msg.type === 'done') {
        this.workers.delete(task.id)

        if (task.type === 'clone_marketplace') {
          const childCount = (this.db.prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE parent_task_id=?`).get(task.id) as { cnt: number }).cnt

          if (childCount > 0) {
            // Children exist — store parsed data, keep parent as 'running'
            this.storeMarketplaceParsedData(task.id, {
              gitSha: msg.gitSha,
              localPlugins: msg.plugins ?? [],
              pluginEntries: msg.pluginEntries ?? [],
            })
            this.db.prepare(`UPDATE tasks SET progress=50, message='Cloning external plugins...' WHERE id=?`).run(task.id)
            this.drainQueue()
          } else {
            // No children — all local plugins, persist immediately
            this.db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`)
              .run(now(), task.id)
            if (this.onMarketplaceDone) {
              this.onMarketplaceDone(task, {
                gitSha: msg.gitSha,
                plugins: msg.plugins ?? [],
                pluginEntries: msg.pluginEntries ?? [],
              })
            }
            this.drainQueue()
          }
        } else {
          // Plugin task (child or standalone)
          this.db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`)
            .run(now(), task.id)

          // If this is a child of a marketplace task, store its result
          if (task.parent_task_id && task.marketplace_id) {
            const taskRow = this.db.prepare(`SELECT plugin_name, source_format, subdir_path FROM tasks WHERE id=?`).get(task.id) as any
            const pluginName = taskRow?.plugin_name
            const sourceFormat = taskRow?.source_format
            const subdirPath = taskRow?.subdir_path
            if (pluginName) {
              const pluginDir = join(this.reposDir, 'plugins', task.marketplace_id, pluginName)
              const localPath = subdirPath ? join(pluginDir, subdirPath) : pluginDir
              this.storeChildResult(task.parent_task_id, {
                name: pluginName,
                source_type: 'external',
                source_format: sourceFormat ?? 'url',
                source_url: task.repo_url,
                local_path: localPath,
                relative_path: `plugins/${pluginName}`,
                git_commit_sha: msg.gitSha ?? null,
                subdir_path: subdirPath ?? null,
              })
            }
          }

          this.updateParentStatus(task.parent_task_id)
          this.drainQueue()
        }
      } else if (msg.type === 'error') {
        this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(msg.message, now(), task.id)
        this.workers.delete(task.id)
        // For marketplace tasks, update marketplace status to 'error'
        if (task.type === 'clone_marketplace' && task.marketplace_id) {
          this.db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(task.marketplace_id)
        }
        this.updateParentStatus(task.parent_task_id)
        this.drainQueue()
      } else if (msg.type === 'create_child_tasks') {
        const childTasks = msg.tasks as Array<{
          id: string
          type: string
          marketplace_id?: string
          plugin_id?: string
          repo_url?: string
          branch?: string
          plugin_name?: string
          source_format?: string
          subdir_path?: string
        }>
        for (const ct of childTasks) {
          this.db.prepare(`INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, plugin_id, repo_url, branch, plugin_name, source_format, subdir_path, progress, created_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
            .run(ct.id, task.id, ct.type, ct.marketplace_id ?? null, ct.plugin_id ?? null, ct.repo_url ?? null, ct.branch ?? null, ct.plugin_name ?? null, ct.source_format ?? null, ct.subdir_path ?? null, now())
        }
        this.drainQueue()
      }
    })

    worker.on('error', (err) => {
      this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run(err.message, now(), task.id)
      this.workers.delete(task.id)
      if (task.type === 'clone_marketplace' && task.marketplace_id) {
        this.db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(task.marketplace_id)
      }
      this.updateParentStatus(task.parent_task_id)
      this.drainQueue()
    })

    worker.on('exit', (code) => {
      // Only handle non-zero exits that weren't already handled
      if (code !== 0 && this.workers.has(task.id)) {
        this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(`Worker exited with code ${code}`, now(), task.id)
        this.workers.delete(task.id)
        if (task.type === 'clone_marketplace' && task.marketplace_id) {
          this.db.prepare(`UPDATE marketplaces SET status='error' WHERE id=?`).run(task.marketplace_id)
        }
        this.updateParentStatus(task.parent_task_id)
        this.drainQueue()
      }
    })
  }
}
