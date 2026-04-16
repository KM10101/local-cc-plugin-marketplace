import type { Marketplace, Plugin, Task, Export } from './types'

const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `${method} ${path} → ${res.status}`)
    ;(err as any).status = res.status
    throw err
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  marketplaces: {
    list: (search?: string) => req<Marketplace[]>('GET', `/marketplaces${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    get: (id: string) => req<Marketplace>('GET', `/marketplaces/${id}`),
    add: (repo_url: string, branch?: string) =>
      req<{ marketplace_id: string; task_id: string }>('POST', '/marketplaces', { repo_url, branch }),
    addBranch: (id: string, branch: string) =>
      req<{ marketplace_id: string; task_id: string }>('POST', `/marketplaces/${id}/branches`, { branch }),
    delete: (id: string) => req<void>('DELETE', `/marketplaces/${id}`),
    refresh: (id: string) => req<{ marketplace_id: string; task_id: string }>('POST', `/marketplaces/${id}/refresh`),
    plugins: (id: string, search?: string) =>
      req<Plugin[]>('GET', `/marketplaces/${id}/plugins${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    repoBranches: (repoUrl: string) =>
      req<{ id: string; branch: string; status: string; name: string }[]>('GET', `/marketplaces/repo-branches?repo_url=${encodeURIComponent(repoUrl)}`),
  },
  plugins: {
    get: (id: string) => req<Plugin>('GET', `/plugins/${id}`),
  },
  tasks: {
    list: (search?: string) => req<Task[]>('GET', `/tasks${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    events: (id: string) => new EventSource(`/api/tasks/${id}/events`),
    stop: (id: string) => req<{ ok: boolean }>('POST', `/tasks/${id}/stop`),
    resume: (id: string) => req<{ ok: boolean }>('POST', `/tasks/${id}/resume`),
    delete: (id: string) => req<void>('DELETE', `/tasks/${id}`),
  },
  exports: {
    list: (search?: string) => req<Export[]>('GET', `/exports${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    get: (id: string) => req<Export & { plugins?: any[] }>('GET', `/exports/${id}`),
    create: (name: string, selected_content: Record<string, string[]>) =>
      req<{ export_id: string }>('POST', '/exports', { name, selected_content }),
    delete: (id: string) => req<void>('DELETE', `/exports/${id}`),
    events: (id: string) => new EventSource(`/api/exports/${id}/events`),
    downloadUrl: (id: string) => `/api/exports/${id}/download`,
  },
  settings: {
    getProxy: () => req<{ enabled: boolean; url: string }>('GET', '/settings/proxy'),
    updateProxy: (config: { enabled: boolean; url: string }) =>
      req<void>('PUT', '/settings/proxy', config),
  },
}
