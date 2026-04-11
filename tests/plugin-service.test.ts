import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readPluginJson, parseMarketplaceJson } from '../server/services/plugin-service.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = join(process.cwd(), 'data', 'test-plugin-fixtures')

beforeAll(() => {
  // Create a fake plugin directory
  mkdirSync(join(TMP, 'my-plugin', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'my-plugin', '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'my-plugin',
      description: 'A test plugin',
      version: '1.2.3',
      author: { name: 'Alice', url: 'https://alice.dev' },
      keywords: ['testing', 'demo'],
      homepage: 'https://example.com',
      license: 'MIT',
    })
  )

  // Create a fake marketplace with two plugins
  mkdirSync(join(TMP, 'my-market', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'my-market', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'my-market',
      description: 'Test marketplace',
      owner: { name: 'Bob' },
      plugins: [
        { name: 'local-plugin', source: './plugins/local-plugin' },
        { name: 'ext-plugin', source: { source: 'github', repo: 'owner/repo' } },
      ],
    })
  )

  mkdirSync(join(TMP, 'all-sources', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'all-sources', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'all-sources-market',
      description: 'Marketplace with all source types',
      owner: { name: 'Charlie' },
      plugins: [
        { name: 'local-plug', description: 'A local plugin', homepage: 'https://local.dev', source: './plugins/local-plug' },
        { name: 'github-plug', description: 'A github plugin', source: { source: 'github', repo: 'owner/github-plug' } },
        { name: 'url-plug', source: { source: 'url', url: 'https://gitlab.com/org/url-plug.git' } },
        { name: 'subdir-plug', description: 'A subdir plugin', source: { source: 'git-subdir', url: 'techwolf-ai/ai-first-toolkit', path: 'plugins/ai-firstify', ref: 'main' } },
        { name: 'subdir-full-url', source: { source: 'git-subdir', url: 'https://github.com/org/monorepo.git', path: 'packages/my-plugin', ref: 'develop' } },
      ],
    })
  )

  mkdirSync(join(TMP, 'single-plugin-repo', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'single-plugin-repo', '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'nightvision-skills',
      description: 'Security scanning skills',
      version: '2.0.0',
      author: { name: 'NVSecurity' },
      homepage: 'https://nightvision.net',
    })
  )

  mkdirSync(join(TMP, 'empty-repo', '.claude-plugin'), { recursive: true })
})

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('readPluginJson', () => {
  it('reads and returns plugin metadata', async () => {
    const result = await readPluginJson(join(TMP, 'my-plugin'))
    expect(result.name).toBe('my-plugin')
    expect(result.version).toBe('1.2.3')
    expect(result.author).toBe('Alice')
    expect(result.author_url).toBe('https://alice.dev')
    expect(result.keywords).toBe('["testing","demo"]')
    expect(result.license).toBe('MIT')
  })

  it('returns null for missing fields gracefully', async () => {
    mkdirSync(join(TMP, 'bare-plugin', '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(TMP, 'bare-plugin', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'bare-plugin' })
    )
    const result = await readPluginJson(join(TMP, 'bare-plugin'))
    expect(result.name).toBe('bare-plugin')
    expect(result.version).toBeNull()
    expect(result.author).toBeNull()
  })
})

describe('parseMarketplaceJson', () => {
  it('extracts marketplace metadata and plugin list', async () => {
    const result = await parseMarketplaceJson(join(TMP, 'my-market'))
    expect(result.name).toBe('my-market')
    expect(result.description).toBe('Test marketplace')
    expect(result.owner).toBe('Bob')
    expect(result.plugins).toHaveLength(2)
    expect(result.plugins[0].name).toBe('local-plugin')
    expect(result.plugins[0].source_type).toBe('local')
    expect(result.plugins[1].source_type).toBe('external')
    expect(result.plugins[1].source_url).toBe('https://github.com/owner/repo.git')
  })
})

describe('parseMarketplaceJson — enriched entries', () => {
  it('parses all source types with new fields', async () => {
    const result = await parseMarketplaceJson(join(TMP, 'all-sources'))
    expect(result.plugins).toHaveLength(5)

    const local = result.plugins[0]
    expect(local.name).toBe('local-plug')
    expect(local.source_type).toBe('local')
    expect(local.source_format).toBe('local')
    expect(local.fallback_description).toBe('A local plugin')
    expect(local.fallback_homepage).toBe('https://local.dev')

    const github = result.plugins[1]
    expect(github.source_type).toBe('external')
    expect(github.source_format).toBe('github')
    expect(github.source_url).toBe('https://github.com/owner/github-plug.git')
    expect(github.fallback_description).toBe('A github plugin')

    const url = result.plugins[2]
    expect(url.source_format).toBe('url')
    expect(url.source_url).toBe('https://gitlab.com/org/url-plug.git')

    const subdir = result.plugins[3]
    expect(subdir.source_format).toBe('git-subdir')
    expect(subdir.source_url).toBe('https://github.com/techwolf-ai/ai-first-toolkit.git')
    expect(subdir.subdir_path).toBe('plugins/ai-firstify')
    expect(subdir.ref).toBe('main')
    expect(subdir.fallback_description).toBe('A subdir plugin')

    const subdirFull = result.plugins[4]
    expect(subdirFull.source_format).toBe('git-subdir')
    expect(subdirFull.source_url).toBe('https://github.com/org/monorepo.git')
    expect(subdirFull.subdir_path).toBe('packages/my-plugin')
    expect(subdirFull.ref).toBe('develop')
  })
})

describe('parseMarketplaceJson — fallback discovery', () => {
  it('falls back to plugin.json when marketplace.json is missing', async () => {
    const result = await parseMarketplaceJson(join(TMP, 'single-plugin-repo'))
    expect(result.name).toBe('nightvision-skills')
    expect(result.description).toBe('Security scanning skills')
    expect(result.owner).toBe('NVSecurity')
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].name).toBe('nightvision-skills')
    expect(result.plugins[0].source_type).toBe('local')
    expect(result.plugins[0].relative_path).toBe('.')
    expect(result.plugins[0].fallback_description).toBe('Security scanning skills')
    expect(result.plugins[0].fallback_version).toBe('2.0.0')
  })

  it('throws when neither marketplace.json nor plugin.json exists', async () => {
    await expect(parseMarketplaceJson(join(TMP, 'empty-repo'))).rejects.toThrow(
      /No marketplace\.json or plugin\.json found/
    )
  })
})
