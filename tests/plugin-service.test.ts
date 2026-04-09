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
