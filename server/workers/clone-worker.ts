import { workerData, parentPort } from 'worker_threads'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { parseMarketplaceJson } from '../services/plugin-service.js'

export interface CloneWorkerInput {
  marketplaceId: string
  sourceUrl: string
  reposDir: string       // e.g. data/repos
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

async function run() {
  const { marketplaceId, sourceUrl, reposDir } = workerData as CloneWorkerInput

  const marketplaceDir = join(reposDir, 'marketplaces', marketplaceId)

  try {
    // Step 1: Clone marketplace repo
    post({ type: 'progress', progress: 5, message: `Cloning marketplace from ${sourceUrl}` })

    await mkdir(join(reposDir, 'marketplaces'), { recursive: true })

    if (existsSync(marketplaceDir)) {
      // Already cloned — pull latest
      const git = simpleGit(marketplaceDir)
      await git.pull()
    } else {
      await simpleGit().clone(sourceUrl, marketplaceDir)
    }

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

      try {
        if (existsSync(pluginDir)) {
          const git = simpleGit(pluginDir)
          await git.pull()
        } else {
          await simpleGit().clone(plugin.source_url!, pluginDir)
        }
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

run()
