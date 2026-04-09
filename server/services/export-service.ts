import { readFile, readdir } from 'fs/promises'
import { join, relative } from 'path'
import { stat } from 'fs/promises'
import archiver from 'archiver'
import { createWriteStream, existsSync } from 'fs'

export interface SelectedPlugin {
  name: string
  source_type: 'local' | 'external'
  local_path: string
}

export interface ExportMarketplaceInput {
  marketplaceLocalPath: string
  marketplaceName: string
  selectedPlugins: SelectedPlugin[]
}

export interface ExportStructureResult {
  marketplaceJson: any
  copyEntries: { src: string; destRelative: string }[]
}

export async function buildExportStructure(input: ExportMarketplaceInput): Promise<ExportStructureResult> {
  const { marketplaceLocalPath, marketplaceName, selectedPlugins } = input

  // Read original marketplace.json for non-plugin fields
  const rawMeta = await readFile(join(marketplaceLocalPath, '.claude-plugin', 'marketplace.json'), 'utf-8')
  const originalMeta = JSON.parse(rawMeta)

  // Rewrite plugins array to use local relative paths only
  const rewrittenPlugins = selectedPlugins.map(p => ({
    name: p.name,
    source: `./plugins/${p.name}`,
    description: originalMeta.plugins?.find((op: any) => op.name === p.name)?.description,
  }))

  const marketplaceJson = {
    ...originalMeta,
    plugins: rewrittenPlugins,
  }

  // Build copy entries: all files under each plugin's local_path
  const copyEntries: { src: string; destRelative: string }[] = []

  for (const plugin of selectedPlugins) {
    if (!existsSync(plugin.local_path)) continue
    const files = await collectFiles(plugin.local_path)
    for (const file of files) {
      const relFromPlugin = relative(plugin.local_path, file)
      copyEntries.push({
        src: file,
        destRelative: join(marketplaceName, 'plugins', plugin.name, relFromPlugin),
      })
    }
  }

  return { marketplaceJson, copyEntries }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}

export interface BuildZipInput {
  exportId: string
  exportName: string
  marketplaces: ExportMarketplaceInput[]
  exportsDir: string
  onProgress: (pct: number, msg: string) => void
}

export async function buildZip(input: BuildZipInput): Promise<{ zipPath: string; zipSize: number }> {
  const { exportId, exportName, marketplaces, exportsDir, onProgress } = input
  const zipPath = join(exportsDir, `${exportId}.zip`)

  onProgress(5, 'Preparing export structure')

  const results = await Promise.all(marketplaces.map(m => buildExportStructure(m)))

  onProgress(20, 'Generating install scripts')

  const marketplaceNames = marketplaces.map(m => m.marketplaceName)
  const scripts = generateInstallScripts(marketplaceNames)
  const readme = generateReadme(marketplaceNames, marketplaces)

  onProgress(30, 'Packaging files into zip')

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    const rootDir = exportName

    // Add install scripts and README
    archive.append(scripts.sh, { name: `${rootDir}/install.sh` })
    archive.append(scripts.bat, { name: `${rootDir}/install.bat` })
    archive.append(scripts.ps1, { name: `${rootDir}/install.ps1` })
    archive.append(readme, { name: `${rootDir}/README.md` })

    // Add marketplace.json files and plugin files
    for (let i = 0; i < marketplaces.length; i++) {
      const m = marketplaces[i]
      const result = results[i]
      archive.append(JSON.stringify(result.marketplaceJson, null, 2), {
        name: `${rootDir}/${m.marketplaceName}/.claude-plugin/marketplace.json`,
      })

      for (const entry of result.copyEntries) {
        archive.file(entry.src, { name: `${rootDir}/${entry.destRelative}` })
      }
    }

    archive.finalize()
  })

  const { size } = await stat(zipPath)
  return { zipPath, zipSize: size }
}

function generateInstallScripts(marketplaceNames: string[]) {
  const bat = [
    '@echo off',
    'set DIR=%~dp0',
    'echo Run the following commands in Claude Code:',
    'echo.',
    ...marketplaceNames.map(n => `echo /plugin marketplace add %DIR%${n}`),
    'pause',
  ].join('\r\n')

  const ps1 = [
    '$dir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    'Write-Host "Run the following commands in Claude Code:"',
    'Write-Host ""',
    ...marketplaceNames.map(n => `Write-Host "/plugin marketplace add $dir\\${n}"`),
  ].join('\n')

  const sh = [
    '#!/bin/bash',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'echo "Run the following commands in Claude Code:"',
    'echo ""',
    ...marketplaceNames.map(n => `echo "/plugin marketplace add $DIR/${n}"`),
  ].join('\n')

  return { bat, ps1, sh }
}

function generateReadme(marketplaceNames: string[], marketplaces: ExportMarketplaceInput[]) {
  const lines = [
    '# Claude Code Plugin Marketplace - Offline Package',
    '',
    '## Contents',
    '',
    ...marketplaces.map(m =>
      `- **${m.marketplaceName}** — ${m.selectedPlugins.length} plugin(s): ${m.selectedPlugins.map(p => p.name).join(', ')}`
    ),
    '',
    '## Prerequisites',
    '',
    '- [Claude Code](https://claude.ai/code) installed',
    '',
    '## Installation',
    '',
    '1. Extract this zip to any directory',
    '2. Run the install script for your OS to get the commands:',
    '   - **Windows CMD:** `install.bat`',
    '   - **Windows PowerShell:** `powershell -ExecutionPolicy Bypass -File install.ps1`',
    '   - **Linux / macOS:** `bash install.sh`',
    '3. Copy each printed command and run it in Claude Code',
    '',
    '## Notes',
    '',
    'The scripts detect their own location automatically.',
    'You can extract this package to any path — the generated commands will reflect the correct absolute paths.',
  ]
  return lines.join('\n')
}
