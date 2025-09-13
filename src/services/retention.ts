import type { Env } from '../types';
import { log } from './log';

const KEY_RETENTION_DAYS = 'retention_days';

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return (row?.value ?? null);
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export async function getRetentionDays(env: Env): Promise<number | null> {
  // 1) settings key takes precedence
  const val = await getSetting(env, KEY_RETENTION_DAYS);
  if (val) {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  // 2) fall back to env var if present
  const raw = (env as any)?.RETENTION_DAYS as string | undefined;
  if (raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  return null; // disabled by default
}

export async function setRetentionDays(env: Env, days: number): Promise<void> {
  const d = Math.max(1, Math.floor(days));
  await setSetting(env, KEY_RETENTION_DAYS, String(d));
}

export async function purgeOldData(env: Env, now: number): Promise<void> {
  try {
    const days = await getRetentionDays(env);
    if (!days) { return; }
    const cutoff = now - days * 24 * 60 * 60;
    // Purge only inactive (released) holds older than cutoff
    const res = await env.DB
      .prepare('DELETE FROM holds WHERE released_at IS NOT NULL AND released_at < ?')
      .bind(cutoff)
      .run();
    await log(env, 'info', 'retention: purged old holds', { days, cutoff, success: (res as any)?.success !== false });
    // Note: queue table holds only current entries; no historical queue is stored, so no purge needed there.
  } catch (err: any) {
    await log(env, 'warning', 'retention: purge failed', { error: String(err?.message || err) });
  }
}
