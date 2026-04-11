import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export interface PluginJsonResult {
  name: string
  version: string | null
  author: string | null
  author_url: string | null
  description: string | null
  keywords: string | null
  homepage: string | null
  license: string | null
}

export interface MarketplacePluginEntry {
  name: string
  source_type: 'local' | 'external'
  source_url: string | null
  relative_path: string
  source_format: 'local' | 'github' | 'url' | 'git-subdir'
  subdir_path: string | null
  ref: string | null
  fallback_description: string | null
  fallback_homepage: string | null
  fallback_keywords: string | null
  fallback_version: string | null
  fallback_author: string | null
}

export interface MarketplaceJsonResult {
  name: string
  description: string | null
  owner: string | null
  plugins: MarketplacePluginEntry[]
}

export async function readPluginJson(pluginDir: string): Promise<PluginJsonResult> {
  const raw = await readFile(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse plugin.json in ${pluginDir}: invalid JSON`)
  }
  return {
    name: json.name ?? '',
    version: json.version ?? null,
    author: typeof json.author === 'object' ? (json.author?.name ?? null) : (json.author ?? null),
    author_url: typeof json.author === 'object' ? (json.author?.url ?? null) : null,
    description: json.description ?? null,
    keywords: json.keywords ? JSON.stringify(json.keywords) : null,
    homepage: json.homepage ?? null,
    license: json.license ?? null,
  }
}

function normalizeGitUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('git@')) {
    return url
  }
  return `https://github.com/${url}.git`
}

function extractFallbackMeta(entry: any) {
  return {
    fallback_description: entry.description ?? null,
    fallback_homepage: entry.homepage ?? null,
    fallback_keywords: entry.keywords ? JSON.stringify(entry.keywords) : null,
    fallback_version: entry.version ?? null,
    fallback_author: typeof entry.author === 'object'
      ? (entry.author?.name ?? null)
      : (entry.author ?? null),
  }
}

export async function parseMarketplaceJson(marketplaceDir: string): Promise<MarketplaceJsonResult> {
  const marketplacePath = join(marketplaceDir, '.claude-plugin', 'marketplace.json')
  const pluginJsonPath = join(marketplaceDir, '.claude-plugin', 'plugin.json')

  if (!existsSync(marketplacePath)) {
    if (existsSync(pluginJsonPath)) {
      return parseSinglePluginRepo(marketplaceDir, pluginJsonPath)
    }
    throw new Error(`No marketplace.json or plugin.json found in ${marketplaceDir}`)
  }

  const raw = await readFile(marketplacePath, 'utf-8')
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse marketplace.json in ${marketplaceDir}: invalid JSON`)
  }

  const plugins: MarketplacePluginEntry[] = (json.plugins ?? []).map((p: any) => {
    const fallback = extractFallbackMeta(p)

    if (typeof p.source === 'string') {
      const rel = p.source.startsWith('./') ? p.source.slice(2) : p.source
      return {
        name: p.name,
        source_type: 'local' as const,
        source_url: null,
        relative_path: rel || '.',
        source_format: 'local' as const,
        subdir_path: null,
        ref: null,
        ...fallback,
      }
    } else if (p.source?.source === 'github') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: `https://github.com/${p.source.repo}.git`,
        relative_path: `plugins/${p.name}`,
        source_format: 'github' as const,
        subdir_path: null,
        ref: p.source.ref ?? null,
        ...fallback,
      }
    } else if (p.source?.source === 'url') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: p.source.url,
        relative_path: `plugins/${p.name}`,
        source_format: 'url' as const,
        subdir_path: null,
        ref: p.source.ref ?? null,
        ...fallback,
      }
    } else if (p.source?.source === 'git-subdir') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: normalizeGitUrl(p.source.url),
        relative_path: `plugins/${p.name}`,
        source_format: 'git-subdir' as const,
        subdir_path: p.source.path ?? null,
        ref: p.source.ref ?? null,
        ...fallback,
      }
    }
    return {
      name: p.name,
      source_type: 'local' as const,
      source_url: null,
      relative_path: `plugins/${p.name}`,
      source_format: 'local' as const,
      subdir_path: null,
      ref: null,
      ...fallback,
    }
  })

  return {
    name: json.name ?? '',
    description: json.metadata?.description ?? json.description ?? null,
    owner: json.owner?.name ?? null,
    plugins,
  }
}

async function parseSinglePluginRepo(marketplaceDir: string, pluginJsonPath: string): Promise<MarketplaceJsonResult> {
  const raw = await readFile(pluginJsonPath, 'utf-8')
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse plugin.json in ${marketplaceDir}: invalid JSON`)
  }

  const authorName = typeof json.author === 'object' ? (json.author?.name ?? null) : (json.author ?? null)

  return {
    name: json.name ?? '',
    description: json.description ?? null,
    owner: authorName,
    plugins: [{
      name: json.name ?? '',
      source_type: 'local' as const,
      source_url: null,
      relative_path: '.',
      source_format: 'local' as const,
      subdir_path: null,
      ref: null,
      fallback_description: json.description ?? null,
      fallback_homepage: json.homepage ?? null,
      fallback_keywords: json.keywords ? JSON.stringify(json.keywords) : null,
      fallback_version: json.version ?? null,
      fallback_author: authorName,
    }],
  }
}
