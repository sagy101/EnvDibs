import type { Env } from '../types';
import { withTransaction } from './db';
import { log } from './log';
import { uuid } from '../util/ids';
import { normalizeEnvName } from '../util/names';

export async function addEnvironment(
  env: Env,
  userId: string,
  name: string,
  opts?: { defaultSeconds?: number; description?: string }
) {
  const db = env.DB;
  const normalized = normalizeEnvName(name);
  const now = Math.floor(Date.now() / 1000);
  const defaultSeconds = opts?.defaultSeconds ?? 7200;
  const description = opts?.description ?? null;

  return withTransaction(db, async () => {
    await log(env, 'info', 'envs:add begin', { name: normalized, defaultSeconds, hasDesc: Boolean(description), by: userId });
    const existing = await db
      .prepare('SELECT id, is_archived FROM envs WHERE name = ?')
      .bind(normalized)
      .first<{ id: string; is_archived: number }>();

    if (existing?.id) {
      if (existing.is_archived) {
        await db
          .prepare('UPDATE envs SET is_archived = 0, default_ttl_seconds = COALESCE(?, default_ttl_seconds), description = COALESCE(?, description) WHERE id = ?')
          .bind(opts?.defaultSeconds ?? null, description, existing.id)
          .run();
        await log(env, 'info', 'envs:unarchived', { name: normalized, id: existing.id });
        return { ok: true, message: `Unarchived environment \`${normalized}\`.` };
      }
      await log(env, 'info', 'envs:exists', { name: normalized, id: existing.id });
      return { ok: true, message: `Environment \`${normalized}\` already exists.` };
    }

    const id = uuid();
    await db
      .prepare(
        'INSERT INTO envs (id, name, description, default_ttl_seconds, created_by, created_at, is_archived) VALUES (?, ?, ?, ?, ?, ?, 0)'
      )
      .bind(id, normalized, description, defaultSeconds, userId, now)
      .run();

    await log(env, 'info', 'envs:created', { name: normalized, id });
    return { ok: true, message: `Created environment \`${normalized}\` (default ${Math.round(defaultSeconds / 60)}m).` };
  });
}

export async function ensureEnvSchema(env: Env): Promise<void> {
  try {
    await env.DB.exec('ALTER TABLE envs ADD COLUMN max_ttl_seconds INTEGER');
  } catch {
    // ignore if exists
  }
  try {
    await env.DB.exec('ALTER TABLE envs ADD COLUMN announce_enabled INTEGER');
  } catch {
    // ignore if exists
  }
  try {
    await env.DB.exec('ALTER TABLE envs ADD COLUMN channel_id TEXT');
  } catch {
    // ignore if exists
  }
}

export type EnvRow = {
  id: string;
  name: string;
  description?: string | null;
  default_ttl_seconds: number;
  max_ttl_seconds: number | null;
  channel_id: string | null;
  announce_enabled: number | null;
};

export async function getEnvByName(env: Env, name: string): Promise<EnvRow | null> {
  await ensureEnvSchema(env);
  const normalized = normalizeEnvName(name);
  const row = await env.DB
    .prepare(`
      SELECT id, name, description, default_ttl_seconds, max_ttl_seconds, channel_id, announce_enabled
      FROM envs
      WHERE name = ? AND is_archived = 0
    `)
    .bind(normalized)
    .first<EnvRow>();
  return row ?? null;
}

export async function setDefaultTTL(
  env: Env,
  name: string,
  seconds: number
): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeEnvName(name);
  const res = await env.DB
    .prepare('UPDATE envs SET default_ttl_seconds = ? WHERE name = ? AND is_archived = 0')
    .bind(seconds, normalized)
    .run();
  if ((res as any)?.success === false) {
    return { ok: false, message: `Failed to update default TTL for ${normalized}.` };
  }
  await log(env, 'info', 'envs:set-default', { name: normalized, seconds });
  return { ok: true, message: `Default TTL for \`${normalized}\` set to ${Math.round(seconds / 60)}m.` };
}

export async function setMaxTTL(
  env: Env,
  name: string,
  seconds: number | null
): Promise<{ ok: boolean; message: string }> {
  await ensureEnvSchema(env);
  const normalized = normalizeEnvName(name);
  const res = await env.DB
    .prepare('UPDATE envs SET max_ttl_seconds = ? WHERE name = ? AND is_archived = 0')
    .bind(seconds, normalized)
    .run();
  if ((res as any)?.success === false) {
    return { ok: false, message: `Failed to update max TTL for ${normalized}.` };
  }
  await log(env, 'info', 'envs:set-max', { name: normalized, seconds });
  const text = seconds ? `${Math.round(seconds / 60)}m` : 'no limit';
  return { ok: true, message: `Max TTL for \`${normalized}\` set to ${text}.` };
}

export async function archiveEnvironment(env: Env, name: string): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeEnvName(name);
  await env.DB
    .prepare('UPDATE envs SET is_archived = 1 WHERE name = ?')
    .bind(normalized)
    .run();
  await log(env, 'info', 'envs:archived', { name: normalized });
  return { ok: true, message: `Archived environment \`${normalized}\`.` };
}

export async function unarchiveEnvironment(env: Env, name: string): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeEnvName(name);
  await env.DB
    .prepare('UPDATE envs SET is_archived = 0 WHERE name = ?')
    .bind(normalized)
    .run();
  await log(env, 'info', 'envs:unarchived:explicit', { name: normalized });
  return { ok: true, message: `Unarchived environment \`${normalized}\`.` };
}

export async function renameEnvironment(env: Env, oldName: string, newName: string): Promise<{ ok: boolean; message: string }> {
  const from = normalizeEnvName(oldName);
  const to = normalizeEnvName(newName);
  if (from === to) {return { ok: false, message: 'New name is the same as current name.' };}
  const exists = await env.DB
    .prepare('SELECT id FROM envs WHERE name = ?')
    .bind(to)
    .first<{ id: string }>();
  if (exists?.id) {return { ok: false, message: `Environment \`${to}\` already exists.` };}
  const res = await env.DB
    .prepare('UPDATE envs SET name = ? WHERE name = ?')
    .bind(to, from)
    .run();
  if ((res as any)?.success === false) {return { ok: false, message: 'Rename failed.' };}
  await log(env, 'info', 'envs:renamed', { from, to });
  return { ok: true, message: `Renamed environment \`${from}\` to \`${to}\`.` };
}

export async function setEnvAnnounceEnabled(env: Env, name: string, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  await ensureEnvSchema(env);
  const normalized = normalizeEnvName(name);
  await env.DB
    .prepare('UPDATE envs SET announce_enabled = ? WHERE name = ? AND is_archived = 0')
    .bind(enabled ? 1 : 0, normalized)
    .run();
  await log(env, 'info', 'envs:announce:env-toggle', { name: normalized, enabled });
  return { ok: true, message: 'Done.' };
}

export async function setEnvChannelId(env: Env, name: string, channelId: string): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeEnvName(name);
  await env.DB
    .prepare('UPDATE envs SET channel_id = ? WHERE name = ? AND is_archived = 0')
    .bind(channelId, normalized)
    .run();
  await log(env, 'info', 'envs:announce:set-channel', { name: normalized, channelId });
  return { ok: true, message: 'Done.' };
}
