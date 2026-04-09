import { readFile } from 'fs/promises'
import { join } from 'path'

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
  relative_path: string  // relative path within marketplace repo
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

export async function parseMarketplaceJson(marketplaceDir: string): Promise<MarketplaceJsonResult> {
  const raw = await readFile(join(marketplaceDir, '.claude-plugin', 'marketplace.json'), 'utf-8')
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse marketplace.json in ${marketplaceDir}: invalid JSON`)
  }

  const plugins: MarketplacePluginEntry[] = (json.plugins ?? []).map((p: any) => {
    if (typeof p.source === 'string') {
      // Local relative path
      const rel = p.source.startsWith('./') ? p.source.slice(2) : p.source
      return {
        name: p.name,
        source_type: 'local' as const,
        source_url: null,
        relative_path: rel,
      }
    } else if (p.source?.source === 'github') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: `https://github.com/${p.source.repo}.git`,
        relative_path: `plugins/${p.name}`,
      }
    } else if (p.source?.source === 'url') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: p.source.url,
        relative_path: `plugins/${p.name}`,
      }
    } else if (p.source?.source === 'git-subdir') {
      return {
        name: p.name,
        source_type: 'external' as const,
        source_url: p.source.url,
        relative_path: `plugins/${p.name}`,
      }
    }
    return {
      name: p.name,
      source_type: 'local' as const,
      source_url: null,
      relative_path: `plugins/${p.name}`,
    }
  })

  return {
    name: json.name ?? '',
    description: json.description ?? null,
    owner: json.owner?.name ?? null,
    plugins,
  }
}
