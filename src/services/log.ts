import type { Env } from '../types';

export type LogLevel = 'error' | 'warning' | 'info';
const KEY_LOG_LEVEL = 'log_level';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function normalizeLevel(input?: string | null): LogLevel | null {
  if (!input) {return null;}
  const s = input.trim().toLowerCase();
  if (s === 'error') {return 'error';}
  if (s === 'warn' || s === 'warning' || s === 'warnning') {return 'warning';}
  if (s === 'info') {return 'info';}
  return null;
}

async function ensureSettingsTable(env: Env): Promise<void> {
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  } catch {
    // ignore
  }
}

// --- In-memory cache for log level to avoid repeated D1 reads per request ---
let cachedLevel: LogLevel | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000; // short TTL; also updated immediately on set

async function fetchLogLevelFromDB(env: Env): Promise<LogLevel> {
  await ensureSettingsTable(env);
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_LOG_LEVEL)
    .first<{ value: string }>();
  const norm = normalizeLevel(row?.value ?? '') || 'warning'; // default: warning
  return norm;
}

function updateCache(level: LogLevel) {
  cachedLevel = level;
  cachedAt = Date.now();
}

export async function getLogLevel(env: Env): Promise<LogLevel> {
  try {
    const now = Date.now();
    if (cachedLevel && now - cachedAt < CACHE_TTL_MS) {
      return cachedLevel;
    }
    const lvl = await fetchLogLevelFromDB(env);
    updateCache(lvl);
    return lvl;
  } catch {
    // On first boot without schema, default to warning
    return cachedLevel || 'warning';
  }
}

export async function setLogLevel(env: Env, level: LogLevel): Promise<void> {
  await ensureSettingsTable(env);
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_LOG_LEVEL, level)
    .run();
  // Refresh in-memory cache immediately
  updateCache(level);
}

export async function log(env: Env, level: LogLevel, message: string, meta?: Record<string, unknown>): Promise<void> {
  const current = await getLogLevel(env);
  if (LEVEL_ORDER[level] > LEVEL_ORDER[current]) {return;}
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  if (level === 'error') {console.error(`[ERROR] ${message}${payload}`);}
  else if (level === 'warning') {console.warn(`[WARN] ${message}${payload}`);}
  else {console.info(`[INFO] ${message}${payload}`);}
}

// Optional: allow callers to prime the cache once per request to avoid even the
// first lazy fetch during the request lifecycle.
export async function primeLogLevelCache(env: Env): Promise<void> {
  try {
    if (!cachedLevel || Date.now() - cachedAt >= CACHE_TTL_MS) {
      const lvl = await fetchLogLevelFromDB(env);
      updateCache(lvl);
    }
  } catch {
    // ignore; logging will fallback to default if needed
  }
}
