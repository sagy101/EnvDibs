import type { Env } from '../types';

const KEY_DM_ENABLED = 'dm_enabled';
const KEY_DM_REMINDER_ENABLED = 'dm_reminder_enabled';
const KEY_DM_EXPIRY_ENABLED = 'dm_expiry_enabled';
const KEY_REMINDER_LEAD_SECONDS = 'reminder_lead_seconds';
const KEY_REMINDER_MIN_TTL_SECONDS = 'reminder_min_ttl_seconds';
const KEY_ANNOUNCE_GLOBAL_ENABLED = 'announce_global_enabled';
const KEY_DEFAULT_EXTEND_SECONDS = 'default_extend_seconds';
const KEY_COMMAND_ACKS_ENABLED = 'command_acks_enabled';

export async function getDmEnabled(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_DM_ENABLED)
    .first<{ value: string }>();
  const raw = row?.value;
  if (raw === null || raw === undefined) {return true;} // default ON
  return raw === '1' || raw.toLowerCase() === 'true';
}

export async function setDmEnabled(env: Env, enabled: boolean): Promise<void> {
  const value = enabled ? '1' : '0';
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_DM_ENABLED, value)
    .run();
}

function parseBool(value: string | undefined | null, fallback = true): boolean {
  if (value === null || value === undefined) {return fallback;}
  const v = value.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function getDmReminderEnabled(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_DM_REMINDER_ENABLED)
    .first<{ value: string }>();
  if (row?.value === null || row?.value === undefined) {
    // Fallback to global toggle if specific key not set
    return getDmEnabled(env);
  }
  return parseBool(row.value, true);
}

export async function setDmReminderEnabled(env: Env, enabled: boolean): Promise<void> {
  const value = enabled ? '1' : '0';
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_DM_REMINDER_ENABLED, value)
    .run();
}

export async function getDmExpiryEnabled(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_DM_EXPIRY_ENABLED)
    .first<{ value: string }>();
  if (row?.value === null || row?.value === undefined) {
    // Fallback to global toggle if specific key not set
    return getDmEnabled(env);
  }
  return parseBool(row.value, true);
}

export async function setDmExpiryEnabled(env: Env, enabled: boolean): Promise<void> {
  const value = enabled ? '1' : '0';
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_DM_EXPIRY_ENABLED, value)
    .run();
}

export async function getAnnounceGlobalEnabled(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_ANNOUNCE_GLOBAL_ENABLED)
    .first<{ value: string }>();
  return parseBool(row?.value, false);
}

export async function setAnnounceGlobalEnabled(env: Env, enabled: boolean): Promise<void> {
  const value = enabled ? '1' : '0';
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_ANNOUNCE_GLOBAL_ENABLED, value)
    .run();
}

async function getNumberSetting(env: Env, key: string, fallback: number): Promise<number> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  if (!row?.value) {return fallback;}
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function setNumberSetting(env: Env, key: string, value: number): Promise<void> {
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(Math.floor(value)))
    .run();
}

export async function getReminderLeadSeconds(env: Env, fallback = 10 * 60): Promise<number> {
  return getNumberSetting(env, KEY_REMINDER_LEAD_SECONDS, fallback);
}

export async function setReminderLeadSeconds(env: Env, seconds: number): Promise<void> {
  await setNumberSetting(env, KEY_REMINDER_LEAD_SECONDS, seconds);
}

export async function getReminderMinTTLSeconds(env: Env, fallback = 30 * 60): Promise<number> {
  return getNumberSetting(env, KEY_REMINDER_MIN_TTL_SECONDS, fallback);
}

export async function setReminderMinTTLSeconds(env: Env, seconds: number): Promise<void> {
  await setNumberSetting(env, KEY_REMINDER_MIN_TTL_SECONDS, seconds);
}

export async function getDefaultExtendSeconds(env: Env, fallback = 15 * 60): Promise<number> {
  return getNumberSetting(env, KEY_DEFAULT_EXTEND_SECONDS, fallback);
}

export async function setDefaultExtendSeconds(env: Env, seconds: number): Promise<void> {
  await setNumberSetting(env, KEY_DEFAULT_EXTEND_SECONDS, seconds);
}

// Slash command responses (on/off/extend): show responses when enabled; suppress when disabled
export async function getCommandAcksEnabled(env: Env): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(KEY_COMMAND_ACKS_ENABLED)
    .first<{ value: string }>();
  // Default ON to preserve current behavior
  const raw = row?.value;
  if (raw === null || raw === undefined) {return true;}
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function setCommandAcksEnabled(env: Env, enabled: boolean): Promise<void> {
  const value = enabled ? '1' : '0';
  await env.DB
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(KEY_COMMAND_ACKS_ENABLED, value)
    .run();
}
