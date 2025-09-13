-- EnvDibs schema (will be used starting Phase 1+)
PRAGMA foreign_keys = ON;

-- Environments
CREATE TABLE IF NOT EXISTS envs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_ttl_seconds INTEGER NOT NULL DEFAULT 7200,
  max_ttl_seconds INTEGER,
  announce_enabled INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT
);

-- Optional helper index for name lookups (UNIQUE already creates an index; this is defensive)
CREATE INDEX IF NOT EXISTS idx_envs_name ON envs(name);

-- Holds (assignments)
CREATE TABLE IF NOT EXISTS holds (
  id TEXT PRIMARY KEY,
  env_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER,
  reminded_at INTEGER,
  note TEXT,
  FOREIGN KEY (env_id) REFERENCES envs(id)
);

-- Ensure only one active hold per env (released_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_holds_active ON holds(env_id, released_at);
-- Enforce uniqueness for active holds using a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_holds_one_active ON holds(env_id) WHERE released_at IS NULL;

-- Queue
CREATE TABLE IF NOT EXISTS queue (
  id TEXT PRIMARY KEY,
  env_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL,
  requested_ttl_seconds INTEGER,
  UNIQUE (env_id, user_id),
  FOREIGN KEY (env_id) REFERENCES envs(id)
);
CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(env_id, position);

-- Settings (key/value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Dynamic admins
CREATE TABLE IF NOT EXISTS admins (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
