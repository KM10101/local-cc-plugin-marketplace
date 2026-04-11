import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb, type Db } from '../server/db.js'
import { TaskScheduler } from '../server/services/task-scheduler.js'
import { rm } from 'fs/promises'
import { join } from 'path'

const TEST_DB = join(process.cwd(), 'data', 'test-scheduler.sqlite')
let db: Db
let scheduler: TaskScheduler

function now() { return new Date().toISOString() }

beforeEach(() => {
  db = createDb(TEST_DB)
  scheduler = new TaskScheduler(db, { maxConcurrent: 3 })
})

afterEach(async () => {
  scheduler.shutdown()
  db.close()
  await rm(TEST_DB, { force: true })
})

// Helper to insert a task directly
function insertTask(id: string, status: string, parentId: string | null = null, type = 'clone_marketplace') {
  db.prepare(`INSERT INTO tasks (id, parent_task_id, type, status, marketplace_id, repo_url, branch, progress, created_at)
    VALUES (?, ?, ?, ?, 'm1', 'https://github.com/o/r.git', 'main', 0, ?)`)
    .run(id, parentId, type, status, now())
}

describe('TaskScheduler', () => {
  describe('getRunningCount', () => {
    it('returns count of running tasks', () => {
      expect(scheduler.getRunningCount()).toBe(0)
      insertTask('t1', 'running')
      insertTask('t2', 'running')
      insertTask('t3', 'queued')
      expect(scheduler.getRunningCount()).toBe(2)
    })
  })

  describe('getNextQueued', () => {
    it('returns oldest queued task', () => {
      insertTask('t1', 'running')
      insertTask('t2', 'queued')
      insertTask('t3', 'queued')
      const next = scheduler.getNextQueued()
      expect(next).not.toBeNull()
      expect(next!.id).toBe('t2')
    })

    it('returns null when no queued tasks', () => {
      insertTask('t1', 'running')
      insertTask('t2', 'completed')
      expect(scheduler.getNextQueued()).toBeNull()
    })
  })

  describe('stopTask', () => {
    it('updates task status to stopped', () => {
      insertTask('t1', 'running')
      scheduler.stopTask('t1')
      const task = db.prepare(`SELECT status FROM tasks WHERE id='t1'`).get() as { status: string }
      expect(task.status).toBe('stopped')
    })

    it('with parent stops all running/queued children', () => {
      insertTask('p1', 'running')
      insertTask('c1', 'running', 'p1')
      insertTask('c2', 'queued', 'p1')
      insertTask('c3', 'completed', 'p1')

      scheduler.stopTask('p1')

      const c1 = db.prepare(`SELECT status FROM tasks WHERE id='c1'`).get() as { status: string }
      const c2 = db.prepare(`SELECT status FROM tasks WHERE id='c2'`).get() as { status: string }
      const c3 = db.prepare(`SELECT status FROM tasks WHERE id='c3'`).get() as { status: string }
      const p1 = db.prepare(`SELECT status FROM tasks WHERE id='p1'`).get() as { status: string }

      expect(c1.status).toBe('stopped')
      expect(c2.status).toBe('stopped')
      expect(c3.status).toBe('completed') // completed children are not stopped
      expect(p1.status).toBe('stopped')
    })
  })

  describe('resumeTask', () => {
    it('sets stopped task to queued', () => {
      // Use maxConcurrent=0 so drainQueue doesn't immediately start the task
      const noDrainScheduler = new TaskScheduler(db, { maxConcurrent: 0 })
      insertTask('t1', 'stopped')
      noDrainScheduler.resumeTask('t1')
      const task = db.prepare(`SELECT status FROM tasks WHERE id='t1'`).get() as { status: string }
      expect(task.status).toBe('queued')
      noDrainScheduler.shutdown()
    })

    it('with parent resumes stopped children but not completed ones', () => {
      // Use maxConcurrent=0 so drainQueue doesn't immediately start the tasks
      const noDrainScheduler = new TaskScheduler(db, { maxConcurrent: 0 })
      insertTask('p1', 'stopped')
      insertTask('c1', 'stopped', 'p1')
      insertTask('c2', 'failed', 'p1')
      insertTask('c3', 'completed', 'p1')

      noDrainScheduler.resumeTask('p1')

      const c1 = db.prepare(`SELECT status FROM tasks WHERE id='c1'`).get() as { status: string }
      const c2 = db.prepare(`SELECT status FROM tasks WHERE id='c2'`).get() as { status: string }
      const c3 = db.prepare(`SELECT status FROM tasks WHERE id='c3'`).get() as { status: string }
      const p1 = db.prepare(`SELECT status FROM tasks WHERE id='p1'`).get() as { status: string }

      expect(c1.status).toBe('queued')
      expect(c2.status).toBe('queued')
      expect(c3.status).toBe('completed') // completed children stay completed
      expect(p1.status).toBe('queued')
      noDrainScheduler.shutdown()
    })
  })

  describe('deleteTask', () => {
    it('deletes parent and all children', () => {
      insertTask('p1', 'running')
      insertTask('c1', 'running', 'p1')
      insertTask('c2', 'queued', 'p1')
      insertTask('c3', 'completed', 'p1')

      scheduler.deleteTask('p1')

      const remaining = db.prepare(`SELECT id FROM tasks`).all()
      expect(remaining).toHaveLength(0)
    })
  })

  describe('hasActiveTask', () => {
    it('returns true when running/queued task exists for repo+branch', () => {
      insertTask('t1', 'running')
      expect(scheduler.hasActiveTask('https://github.com/o/r.git', 'main')).toBe(true)
    })

    it('returns false when no running/queued tasks for repo+branch', () => {
      insertTask('t1', 'completed')
      insertTask('t2', 'stopped')
      expect(scheduler.hasActiveTask('https://github.com/o/r.git', 'main')).toBe(false)
    })

    it('returns false for different repo+branch', () => {
      insertTask('t1', 'running')
      expect(scheduler.hasActiveTask('https://github.com/o/other.git', 'main')).toBe(false)
    })
  })

  describe('updateParentStatus', () => {
    it('sets parent to completed when all children completed', () => {
      insertTask('p1', 'running')
      insertTask('c1', 'completed', 'p1')
      insertTask('c2', 'completed', 'p1')

      // Set children progress to 100
      db.prepare(`UPDATE tasks SET progress=100 WHERE parent_task_id='p1'`).run()

      scheduler.updateParentStatus('p1')

      const p1 = db.prepare(`SELECT status, progress FROM tasks WHERE id='p1'`).get() as { status: string; progress: number }
      expect(p1.status).toBe('completed')
      expect(p1.progress).toBe(100)
    })

    it('sets parent to running when any child is running', () => {
      insertTask('p1', 'queued')
      insertTask('c1', 'running', 'p1')
      insertTask('c2', 'completed', 'p1')

      scheduler.updateParentStatus('p1')

      const p1 = db.prepare(`SELECT status FROM tasks WHERE id='p1'`).get() as { status: string }
      expect(p1.status).toBe('running')
    })

    it('sets parent to failed when child failed and none running', () => {
      insertTask('p1', 'running')
      insertTask('c1', 'failed', 'p1')
      insertTask('c2', 'completed', 'p1')

      scheduler.updateParentStatus('p1')

      const p1 = db.prepare(`SELECT status FROM tasks WHERE id='p1'`).get() as { status: string }
      expect(p1.status).toBe('failed')
    })

    it('does nothing when parentTaskId is null', () => {
      // Should not throw
      scheduler.updateParentStatus(null)
    })
  })
})
