import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildExportStructure } from '../server/services/export-service.js'
import { mkdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'

const TMP = join(process.cwd(), 'data', 'test-export-fixtures')

beforeAll(() => {
  // Fake marketplace with one local plugin and one external plugin (already cloned)
  mkdirSync(join(TMP, 'market-a', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(TMP, 'market-a', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'market-a',
      description: 'Test',
      owner: { name: 'Test' },
      plugins: [
        { name: 'plugin-local', source: './plugins/plugin-local' },
        { name: 'plugin-ext', source: { source: 'github', repo: 'owner/plugin-ext' } },
      ],
    })
  )
  mkdirSync(join(TMP, 'market-a', 'plugins', 'plugin-local', '.claude-plugin'), { recursive: true })
  writeFileSync(join(TMP, 'market-a', 'plugins', 'plugin-local', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'plugin-local', version: '1.0.0' }))

  mkdirSync(join(TMP, 'ext', 'plugin-ext', '.claude-plugin'), { recursive: true })
  writeFileSync(join(TMP, 'ext', 'plugin-ext', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'plugin-ext', version: '2.0.0' }))
})

afterAll(() => rm(TMP, { recursive: true, force: true }))

describe('buildExportStructure', () => {
  it('returns correct file copy pairs and rewritten marketplace.json', async () => {
    const result = await buildExportStructure({
      marketplaceLocalPath: join(TMP, 'market-a'),
      marketplaceName: 'market-a',
      selectedPlugins: [
        { name: 'plugin-local', source_type: 'local', local_path: join(TMP, 'market-a', 'plugins', 'plugin-local') },
        { name: 'plugin-ext', source_type: 'external', local_path: join(TMP, 'ext', 'plugin-ext') },
      ],
    })

    expect(result.marketplaceJson.plugins).toHaveLength(2)
    // All sources should be local relative paths
    expect(result.marketplaceJson.plugins[0].source).toBe('./plugins/plugin-local')
    expect(result.marketplaceJson.plugins[1].source).toBe('./plugins/plugin-ext')

    // Should have copy entries for each plugin
    expect(result.copyEntries.length).toBeGreaterThan(0)
  })
})
