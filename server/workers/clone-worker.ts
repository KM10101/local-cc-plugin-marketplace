import { workerData, parentPort } from 'worker_threads'
import { simpleGit } from 'simple-git'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { parseMarketplaceJson, type MarketplacePluginEntry } from '../services/plugin-service.js'

export type ProgressCallback = (message: string, percent?: number) => void

export interface CloneWorkerInput {
  mode: 'marketplace' | 'plugin'
  taskId: string
  marketplaceId?: string
  pluginId?: string
  sourceUrl: string
  branch?: string
  reposDir?: string
  pluginDir?: string
  pluginName?: string
  sourceFormat?: string
  subdirPath?: string
  proxy?: { enabled: boolean; url: string }
}

export type CloneWorkerMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; gitSha: string; plugins: ClonePluginResult[]; pluginEntries?: MarketplacePluginEntry[] }
  | { type: 'error'; message: string }
  | { type: 'create_child_tasks'; tasks: ChildTaskEntry[] }

export interface ChildTaskEntry {
  id: string
  type: string
  marketplace_id?: string
  plugin_id?: string
  repo_url?: string
  branch?: string
  plugin_name?: string
  source_format?: string
  subdir_path?: string
}

export interface ClonePluginResult {
  name: string
  source_type: 'local' | 'external'
  source_format: string
  source_url: string | null
  local_path: string
  relative_path: string
  git_commit_sha: string | null
  subdir_path: string | null
}

function post(msg: CloneWorkerMessage) {
  parentPort?.postMessage(msg)
}

function makeGit(dir?: string) {
  const { proxy } = workerData as CloneWorkerInput
  const configOpts = proxy?.enabled && proxy?.url
    ? { config: [`http.proxy=${proxy.url}`, `https.proxy=${proxy.url}`] }
    : undefined
  if (dir) {
    return configOpts ? simpleGit(dir, configOpts) : simpleGit(dir)
  }
  return configOpts ? simpleGit(configOpts) : simpleGit()
}

function parseGitProgress(line: string, baseProgress: number, maxProgress: number): { message: string; progress: number } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length < 3) return null

  const pctMatch = trimmed.match(/(\d+)%/)
  if (pctMatch) {
    const pct = parseInt(pctMatch[1], 10)
    const range = maxProgress - baseProgress
    let phaseStart = 0
    let phaseEnd = 1

    if (trimmed.startsWith('Enumerating') || trimmed.startsWith('remote: Enumerating')) {
      phaseStart = 0; phaseEnd = 0.05
    } else if (trimmed.startsWith('Counting') || trimmed.startsWith('remote: Counting')) {
      phaseStart = 0.05; phaseEnd = 0.15
    } else if (trimmed.startsWith('Compressing') || trimmed.startsWith('remote: Compressing')) {
      phaseStart = 0.15; phaseEnd = 0.25
    } else if (trimmed.startsWith('Receiving')) {
      phaseStart = 0.25; phaseEnd = 0.75
    } else if (trimmed.startsWith('Resolving')) {
      phaseStart = 0.75; phaseEnd = 1.0
    }

    const mapped = baseProgress + range * (phaseStart + (phaseEnd - phaseStart) * (pct / 100))
    return { message: trimmed, progress: Math.round(mapped) }
  }

  return { message: trimmed, progress: baseProgress }
}

async function getHeadSha(repoPath: string): Promise<string | null> {
  try {
    const git = makeGit(repoPath)
    const log = await git.log({ maxCount: 1 })
    return log.latest?.hash ?? null
  } catch {
    return null
  }
}

async function isValidGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false
  try {
    const git = makeGit(dir)
    await git.status()
    return true
  } catch { return false }
}

async function cloneOrPull(sourceUrl: string, targetDir: string, branch?: string, onProgress?: ProgressCallback): Promise<void> {
  if (await isValidGitRepo(targetDir)) {
    const git = makeGit(targetDir)
    if (onProgress) {
      git.outputHandler((_command, _stdout, stderr) => {
        stderr.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split(/\r|\n/).filter(Boolean)
          for (const line of lines) {
            onProgress(line.trim())
          }
        })
      })
    }
    await git.fetch('origin')
    if (branch) {
      try {
        await git.checkout(branch)
      } catch {
        await git.checkoutBranch(branch, `origin/${branch}`)
      }
    }
    await git.pull()
  } else {
    if (existsSync(targetDir)) {
      await rm(targetDir, { recursive: true, force: true })
    }
    const git = makeGit()
    if (onProgress) {
      git.outputHandler((_command, _stdout, stderr) => {
        stderr.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split(/\r|\n/).filter(Boolean)
          for (const line of lines) {
            onProgress(line.trim())
          }
        })
      })
    }
    const cloneOptions: string[] = ['--progress']
    if (branch) {
      cloneOptions.push('--branch', branch)
    }
    await git.clone(sourceUrl, targetDir, cloneOptions)
  }
}

async function cloneSubdir(
  sourceUrl: string,
  targetDir: string,
  subdirPath: string,
  ref?: string,
  onProgress?: ProgressCallback
): Promise<void> {
  if (await isValidGitRepo(targetDir)) {
    const git = makeGit(targetDir)
    if (onProgress) {
      git.outputHandler((_command, _stdout, stderr) => {
        stderr.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split(/\r|\n/).filter(Boolean)
          for (const line of lines) {
            onProgress(line.trim())
          }
        })
      })
    }
    await git.fetch('origin')
    if (ref) {
      try {
        await git.checkout(ref)
      } catch {
        await git.checkoutBranch(ref, `origin/${ref}`)
      }
    }
    await git.pull()
    return
  }

  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true })
  }

  const git = makeGit()
  if (onProgress) {
    git.outputHandler((_command, _stdout, stderr) => {
      stderr.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split(/\r|\n/).filter(Boolean)
        for (const line of lines) {
          onProgress(line.trim())
        }
      })
    })
  }

  const cloneArgs = ['--filter=blob:none', '--sparse', '--progress']
  if (ref) {
    cloneArgs.push('--branch', ref)
  }
  await git.clone(sourceUrl, targetDir, cloneArgs)

  const repoGit = makeGit(targetDir)
  await repoGit.raw(['sparse-checkout', 'set', subdirPath])
}

async function runMarketplace() {
  const { marketplaceId, sourceUrl, branch, reposDir } = workerData as CloneWorkerInput

  if (!marketplaceId || !sourceUrl || !reposDir) {
    post({ type: 'error', message: 'Invalid workerData: marketplaceId, sourceUrl, and reposDir are required' })
    return
  }

  const marketplaceDir = join(reposDir, 'marketplaces', marketplaceId)

  try {
    post({ type: 'progress', progress: 5, message: `Cloning marketplace from ${sourceUrl} (branch: ${branch || 'default'})` })

    await mkdir(join(reposDir, 'marketplaces'), { recursive: true })

    await cloneOrPull(sourceUrl, marketplaceDir, branch, (msg) => {
      const parsed = parseGitProgress(msg, 5, 40)
      if (parsed) post({ type: 'progress', progress: parsed.progress, message: parsed.message })
    })

    post({ type: 'progress', progress: 40, message: 'Marketplace cloned, reading plugin list' })

    const marketplaceMeta = await parseMarketplaceJson(marketplaceDir)
    const externalPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'external')
    const localPlugins = marketplaceMeta.plugins.filter(p => p.source_type === 'local')

    const localResults: ClonePluginResult[] = localPlugins.map(p => ({
      name: p.name,
      source_type: 'local' as const,
      source_format: 'local',
      source_url: null,
      local_path: p.relative_path === '.' ? marketplaceDir : join(marketplaceDir, p.relative_path),
      relative_path: p.relative_path,
      git_commit_sha: null,
      subdir_path: null,
    }))

    if (externalPlugins.length > 0) {
      post({
        type: 'create_child_tasks',
        tasks: externalPlugins.map(p => ({
          id: crypto.randomUUID(),
          type: 'clone_plugin',
          marketplace_id: marketplaceId,
          repo_url: p.source_url!,
          branch: p.ref ?? undefined,
          plugin_name: p.name,
          source_format: p.source_format,
          subdir_path: p.subdir_path ?? undefined,
        })),
      })
    }

    const marketplaceGitSha = await getHeadSha(marketplaceDir)
    post({
      type: 'done',
      gitSha: marketplaceGitSha ?? '',
      plugins: localResults,
      pluginEntries: marketplaceMeta.plugins,
    })
  } catch (err: any) {
    post({ type: 'error', message: err.message ?? String(err) })
  }
}

async function runPlugin() {
  const { sourceUrl, branch, pluginDir, pluginName, sourceFormat, subdirPath } = workerData as CloneWorkerInput

  if (!sourceUrl || !pluginDir) {
    post({ type: 'error', message: 'Invalid workerData: sourceUrl and pluginDir are required' })
    return
  }

  try {
    const label = pluginName ?? sourceUrl
    post({ type: 'progress', progress: 5, message: `Cloning ${label} from ${sourceUrl} (branch: ${branch || 'default'})` })

    await mkdir(pluginDir, { recursive: true })

    const onProgress = (msg: string) => {
      const parsed = parseGitProgress(msg, 5, 90)
      if (parsed) post({ type: 'progress', progress: parsed.progress, message: parsed.message })
    }

    if (sourceFormat === 'git-subdir' && subdirPath) {
      await cloneSubdir(sourceUrl, pluginDir, subdirPath, branch, onProgress)
    } else {
      await cloneOrPull(sourceUrl, pluginDir, branch, onProgress)
    }

    post({ type: 'progress', progress: 95, message: 'Clone complete, reading commit SHA' })

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
