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

  describe('marketplace parsed data storage', () => {
    it('stores marketplace parsed data for tasks with children', () => {
      insertTask('p1', 'running')
      scheduler.storeMarketplaceParsedData('p1', {
        gitSha: 'abc123',
        localPlugins: [],
        pluginEntries: [],
      })
      const data = scheduler.getMarketplaceParsedData('p1')
      expect(data).not.toBeNull()
      expect(data!.gitSha).toBe('abc123')
    })

    it('stores child results', () => {
      insertTask('p1', 'running')
      scheduler.storeChildResult('p1', {
        name: 'test-plugin',
        source_type: 'external',
        source_format: 'github',
        source_url: 'https://github.com/o/r.git',
        local_path: '/tmp/test',
        relative_path: 'plugins/test-plugin',
        git_commit_sha: 'def456',
        subdir_path: null,
      })
      const results = scheduler.getChildResults('p1')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('test-plugin')
    })

    it('cleans up parsed data and child results', () => {
      scheduler.storeMarketplaceParsedData('p1', { gitSha: 'abc', localPlugins: [], pluginEntries: [] })
      scheduler.storeChildResult('p1', { name: 'p', source_type: 'external', source_format: 'url', source_url: null, local_path: '/x', relative_path: 'plugins/p', git_commit_sha: null, subdir_path: null })
      scheduler.cleanupParsedData('p1')
      expect(scheduler.getMarketplaceParsedData('p1')).toBeNull()
      expect(scheduler.getChildResults('p1')).toHaveLength(0)
    })
  })

  describe('parent completion triggers onMarketplaceDone', () => {
    it('calls onMarketplaceDone when all children complete', () => {
      let capturedData: any = null

      db.prepare(`INSERT INTO marketplaces (id, repo_url, branch, name, local_path, status, created_at)
        VALUES ('m1', 'https://github.com/o/r.git', 'main', 'repo', '/tmp/m1', 'cloning', ?)`).run(now())

      insertTask('p1', 'running')
      insertTask('c1', 'completed', 'p1', 'clone_plugin')
      insertTask('c2', 'completed', 'p1', 'clone_plugin')
      db.prepare(`UPDATE tasks SET progress=100 WHERE parent_task_id='p1'`).run()

      scheduler.storeMarketplaceParsedData('p1', {
        gitSha: 'abc123',
        localPlugins: [{ name: 'local-p', source_type: 'local', source_format: 'local', source_url: null, local_path: '/tmp/lp', relative_path: '.', git_commit_sha: null, subdir_path: null }],
        pluginEntries: [],
      })
      scheduler.storeChildResult('p1', {
        name: 'ext-p', source_type: 'external', source_format: 'github',
        source_url: 'https://github.com/o/r.git', local_path: '/tmp/ep',
        relative_path: 'plugins/ext-p', git_commit_sha: 'def456', subdir_path: null,
      })

      scheduler.onMarketplaceDone = (_task, data) => {
        capturedData = data
      }

      scheduler.updateParentStatus('p1')

      expect(capturedData).not.toBeNull()
      expect(capturedData.gitSha).toBe('abc123')
      expect(capturedData.plugins).toHaveLength(2)
      expect(capturedData.plugins[0].name).toBe('local-p')
      expect(capturedData.plugins[1].name).toBe('ext-p')
    })

    it('does not call onMarketplaceDone when children still running', () => {
      let called = false

      insertTask('p1', 'running')
      insertTask('c1', 'completed', 'p1', 'clone_plugin')
      insertTask('c2', 'running', 'p1', 'clone_plugin')

      scheduler.onMarketplaceDone = () => { called = true }
      scheduler.updateParentStatus('p1')

      expect(called).toBe(false)
    })
  })
})
