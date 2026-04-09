const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  marketplaces: {
    list: () => req<any[]>('GET', '/marketplaces'),
    add: (source_url: string) => req<any>('POST', '/marketplaces', { source_url }),
    delete: (id: string) => req<void>('DELETE', `/marketplaces/${id}`),
    refresh: (id: string) => req<any>('POST', `/marketplaces/${id}/refresh`),
    plugins: (id: string) => req<any[]>('GET', `/marketplaces/${id}/plugins`),
  },
  plugins: {
    get: (id: string) => req<any>('GET', `/plugins/${id}`),
  },
  tasks: {
    list: () => req<any[]>('GET', '/tasks'),
    events: (id: string) => new EventSource(`/api/tasks/${id}/events`),
  },
  exports: {
    list: () => req<any[]>('GET', '/exports'),
    get: (id: string) => req<any>('GET', `/exports/${id}`),
    create: (name: string, selected_content: Record<string, string[]>) =>
      req<any>('POST', '/exports', { name, selected_content }),
    delete: (id: string) => req<void>('DELETE', `/exports/${id}`),
    events: (id: string) => new EventSource(`/api/exports/${id}/events`),
    downloadUrl: (id: string) => `/api/exports/${id}/download`,
  },
}
