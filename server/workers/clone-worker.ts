import { workerData, parentPort } from 'worker_threads'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { parseMarketplaceJson } from '../services/plugin-service.js'

export interface CloneWorkerInput {
  mode: 'marketplace' | 'plugin'
  taskId: string
  marketplaceId?: string
  pluginId?: string
  sourceUrl: string
  branch?: string
  reposDir?: string    // for marketplace mode
  pluginDir?: string   // for plugin mode
}

export type CloneWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; gitSha: string; plugins: ClonePluginResult[] }
  | { type: 'error'; message: string }

export interface ClonePluginResult {
  name: string
  source_type: 'local' | 'external'
  source_url: string | null
  local_path: string
  relative_path: string
  git_commit_sha: string | null
}

function post(msg: CloneWorkerMessage) {
  parentPort?.postMessage(msg)
}

async function getHeadSha(repoPath: string): Promise<string | null> {
  try {
    const git = simpleGit(repoPath)
    const log = await git.log({ maxCount: 1 })
    return log.latest?.hash ?? null
  } catch {
    return null
  }
}

async function isValidGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false
  try {
    const git = simpleGit(dir)
    await git.status()
    return true
  } catch { return false }
}

async function cloneOrPull(sourceUrl: string, targetDir: string, branch?: string): Promise<void> {
  if (await isValidGitRepo(targetDir)) {
    // Incremental update: fetch and pull
    const git = simpleGit(targetDir)
    await git.fetch('origin')
    if (branch) {
      try {
        await git.checkout(branch)
      } catch {
        // Branch doesn't exist locally, create it tracking origin/branch
        await git.checkoutBranch(branch, `origin/${branch}`)
      }
    }
    await git.pull()
  } else {
    // Clean up incomplete clone if directory exists
    if (existsSync(targetDir)) {
      await rm(targetDir, { recursive: true, force: true })
    }
    // Fresh clone
    const cloneOptions: string[] = []
    if (branch) {
      cloneOptions.push('--branch', branch)
    }
    await simpleGit().clone(sourceUrl, targetDir, cloneOptions)
  }
}

async function runMarketplace() {
  const { marketplaceId, sourceUrl, branch, reposDir } = workerData as CloneWorkerInput

  if (!marketplaceId || !sourceUrl || !reposDir) {
    post({ type: 'error', message: 'Invalid workerData: marketplaceId, sourceUrl, and reposDir are required' })
    return
  }

  const marketplaceDir = join(reposDir, 'marketplaces', marketplaceId)

  try {
    // Step 1: Clone/pull marketplace repo
    post({ type: 'progress', progress: 5, message: `Cloning marketplace from ${sourceUrl} (branch: ${branch || 'default'})` })

    await mkdir(join(reposDir, 'marketplaces'), { recursive: true })

    await cloneOrPull(sourceUrl, marketplaceDir, branch)

    post({ type: 'progress', progress: 40, message: 'Marketplace cloned, reading plugin list' })

    // Step 2: Parse marketplace.json
    const marketplaceMeta = await parseMarketplaceJson(marketplaceDir)
    const externalPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'external')
    const localPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'local')

    const results: ClonePluginResult[] = []

    // Local plugins already exist in marketplace repo
    for (const p of localPlugins) {
      const localPath = join(marketplaceDir, p.relative_path)
      results.push({
        name: p.name,
        source_type: 'local',
        source_url: null,
        local_path: localPath,
        relative_path: p.relative_path,
        git_commit_sha: null,
      })
    }

    // Step 3: Clone external plugins
    const pluginsBaseDir = join(reposDir, 'plugins', marketplaceId)
    await mkdir(pluginsBaseDir, { recursive: true })

    for (let i = 0; i < externalPlugins.length; i++) {
      const plugin = externalPlugins[i]
      const pluginDir = join(pluginsBaseDir, plugin.name)
      const progressPct = 40 + Math.round(((i + 1) / externalPlugins.length) * 55)

      post({
        type: 'progress',
        progress: progressPct,
        message: `Cloning plugin ${i + 1}/${externalPlugins.length}: ${plugin.name}`,
      })

      if (!plugin.source_url) {
        post({
          type: 'progress',
          progress: progressPct,
          message: `Warning: skipping ${plugin.name} - no source URL`,
        })
        results.push({
          name: plugin.name,
          source_type: 'external',
          source_url: null,
          local_path: pluginDir,
          relative_path: plugin.relative_path,
          git_commit_sha: null,
        })
        continue
      }

      try {
        await cloneOrPull(plugin.source_url, pluginDir)
        const sha = await getHeadSha(pluginDir)
        results.push({
          name: plugin.name,
          source_type: 'external',
          source_url: plugin.source_url,
          local_path: pluginDir,
          relative_path: plugin.relative_path,
          git_commit_sha: sha,
        })
      } catch (err: any) {
        // Non-fatal: record error but continue with other plugins
        post({
          type: 'progress',
          progress: progressPct,
          message: `Warning: failed to clone ${plugin.name}: ${err.message}`,
        })
        results.push({
          name: plugin.name,
          source_type: 'external',
          source_url: plugin.source_url,
          local_path: pluginDir,
          relative_path: plugin.relative_path,
          git_commit_sha: null,
        })
      }
    }

    const marketplaceGitSha = await getHeadSha(marketplaceDir)
    post({ type: 'done', gitSha: marketplaceGitSha ?? '', plugins: results })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

async function runPlugin() {
  const { sourceUrl, branch, pluginDir, pluginId } = workerData as CloneWorkerInput

  if (!sourceUrl || !pluginDir) {
    post({ type: 'error', message: 'Invalid workerData: sourceUrl and pluginDir are required' })
    return
  }

  try {
    post({ type: 'progress', progress: 10, message: `Cloning plugin from ${sourceUrl} (branch: ${branch || 'default'})` })

    await mkdir(pluginDir, { recursive: true })

    await cloneOrPull(sourceUrl, pluginDir, branch)

    post({ type: 'progress', progress: 90, message: 'Plugin cloned, reading commit SHA' })

    const sha = await getHeadSha(pluginDir)

    post({ type: 'done', gitSha: sha ?? '', plugins: [] })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

// Entry point: dispatch based on mode
const mode = (workerData as CloneWorkerInput)?.mode
if (mode === 'plugin') {
  runPlugin()
} else {
  // Default to marketplace mode for backwards compatibility
  runMarketplace()
}
