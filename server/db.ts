import Database from 'better-sqlite3'

export type Db = InstanceType<typeof Database>

export function createDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplaces (
      id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      description TEXT,
      owner TEXT,
      git_commit_sha TEXT,
      last_updated TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(repo_url, branch)
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      marketplace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT,
      author TEXT,
      author_url TEXT,
      description TEXT,
      keywords TEXT,
      homepage TEXT,
      license TEXT,
      source_type TEXT NOT NULL,
      source_url TEXT,
      source_format TEXT,
      subdir_path TEXT,
      local_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      git_commit_sha TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      marketplace_id TEXT,
      repo_url TEXT,
      branch TEXT,
      plugin_id TEXT,
      plugin_name TEXT,
      source_format TEXT,
      subdir_path TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'packaging',
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      selected_content TEXT NOT NULL,
      zip_path TEXT,
      zip_size INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `)

  return db
}
