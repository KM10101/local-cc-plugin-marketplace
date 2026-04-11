import { Worker } from 'worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { Db } from '../db.js'
import type { Task } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function now() { return new Date().toISOString() }

export class TaskScheduler {
  private db: Db
  private maxConcurrent: number
  private reposDir: string
  private workers: Map<string, Worker> = new Map()

  /** Callback for marketplace-service to hook into when a marketplace clone finishes */
  onMarketplaceDone: ((task: Task, msg: any) => void) | null = null

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

    // Calculate blended progress
    const sumChildProgress = children.reduce((sum, c) => sum + c.progress, 0)
    const blended = Math.round((100 + sumChildProgress) / (1 + children.length))

    if (hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='running', progress=? WHERE id=?`).run(blended, parentTaskId)
    } else if (allCompleted) {
      this.db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`).run(now(), parentTaskId)
    } else if (allStoppedOrQueued && !hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='stopped', progress=? WHERE id=?`).run(blended, parentTaskId)
    } else if (hasFailed && !hasRunning) {
      this.db.prepare(`UPDATE tasks SET status='failed', progress=? WHERE id=?`).run(blended, parentTaskId)
    } else {
      this.db.prepare(`UPDATE tasks SET status='running', progress=? WHERE id=?`).run(blended, parentTaskId)
    }
  }

  shutdown(): void {
    for (const [, worker] of this.workers) {
      try { worker.terminate() } catch { /* ignore */ }
    }
    this.workers.clear()
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
      const plugin = this.db.prepare(`SELECT local_path FROM plugins WHERE id=?`).get(task.plugin_id) as { local_path: string } | undefined
      const pluginDir = plugin?.local_path ?? join(this.reposDir, 'plugins', task.plugin_id ?? 'unknown')
      workerDataPayload = {
        mode: 'plugin',
        taskId: task.id,
        pluginId: task.plugin_id,
        sourceUrl: task.repo_url,
        branch: task.branch,
        pluginDir,
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
        this.db.prepare(`UPDATE tasks SET status='completed', progress=100, completed_at=? WHERE id=?`)
          .run(now(), task.id)
        this.workers.delete(task.id)
        this.updateParentStatus(task.parent_task_id)
        this.drainQueue()
      } else if (msg.type === 'error') {
        this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(msg.message, now(), task.id)
        this.workers.delete(task.id)
        this.updateParentStatus(task.parent_task_id)
        this.drainQueue()
      } else if (msg.type === 'marketplace_done') {
        if (this.onMarketplaceDone) {
          this.onMarketplaceDone(task, msg)
        }
      } else if (msg.type === 'create_child_tasks') {
        // Insert child tasks and drain
        const childTasks = msg.tasks as Array<{
          id: string
          type: string
          marketplace_id?: string
          plugin_id?: string
          repo_url?: string
          branch?: string
        }>
        for (const ct of childTasks) {
          this.db.prepare(`INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, plugin_id, repo_url, branch, progress, created_at)
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, 0, ?)`)
            .run(ct.id, task.id, ct.type, ct.marketplace_id ?? null, ct.plugin_id ?? null, ct.repo_url ?? null, ct.branch ?? null, now())
        }
        this.drainQueue()
      }
    })

    worker.on('error', (err) => {
      this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
        .run(err.message, now(), task.id)
      this.workers.delete(task.id)
      this.updateParentStatus(task.parent_task_id)
      this.drainQueue()
    })

    worker.on('exit', (code) => {
      // Only handle non-zero exits that weren't already handled
      if (code !== 0 && this.workers.has(task.id)) {
        this.db.prepare(`UPDATE tasks SET status='failed', message=?, completed_at=? WHERE id=?`)
          .run(`Worker exited with code ${code}`, now(), task.id)
        this.workers.delete(task.id)
        this.updateParentStatus(task.parent_task_id)
        this.drainQueue()
      }
    })
  }
}
