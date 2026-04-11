export type MarketplaceStatus = 'pending' | 'cloning' | 'ready' | 'error'
export type PluginStatus = 'pending' | 'cloning' | 'ready' | 'error'
export type TaskStatus = 'queued' | 'running' | 'stopped' | 'completed' | 'failed'
export type TaskType = 'clone_marketplace' | 'clone_plugin'
export type ExportStatus = 'packaging' | 'ready' | 'failed'

export interface Marketplace {
  id: string
  repo_url: string
  branch: string
  name: string
  local_path: string
  status: MarketplaceStatus
  description: string | null
  owner: string | null
  git_commit_sha: string | null
  last_updated: string | null
  created_at: string
}

export interface Plugin {
  id: string
  marketplace_id: string
  name: string
  version: string | null
  author: string | null
  author_url: string | null
  description: string | null
  keywords: string | null
  homepage: string | null
  license: string | null
  source_type: 'local' | 'external'
  source_url: string | null
  local_path: string
  status: PluginStatus
  git_commit_sha: string | null
  created_at: string
}

export interface Task {
  id: string
  parent_task_id: string | null
  type: TaskType
  status: TaskStatus
  marketplace_id: string | null
  repo_url: string | null
  branch: string | null
  plugin_id: string | null
  progress: number
  message: string | null
  created_at: string
  completed_at: string | null
  children?: Task[]
}

export interface Export {
  id: string
  name: string
  status: ExportStatus
  progress: number
  message: string | null
  selected_content: string
  zip_path: string | null
  zip_size: number | null
  created_at: string
  completed_at: string | null
}
