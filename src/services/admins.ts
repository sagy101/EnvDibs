import { getUserInfo } from '../slack/api';
import type { Env } from '../types';
import { log } from './log';

async function ensureAdminsTable(env: Env): Promise<void> {
  await env.DB
    .prepare(
      'CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, created_by TEXT NOT NULL)'
    )
    .run();
}

export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  // 1) Static allowlist via wrangler.toml
  const staticAdmins = (env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (staticAdmins.includes(userId)) {return true;}

  // 2) Dynamic admins table
  await ensureAdminsTable(env);
  const row = await env.DB
    .prepare('SELECT user_id FROM admins WHERE user_id = ?')
    .bind(userId)
    .first<{ user_id: string }>();
  if (row?.user_id) {return true;}

  // 3) Slack workspace owner/admin via users.info (if token available)
  if (env.SLACK_BOT_TOKEN) {
    try {
      const info = await getUserInfo(env, env.SLACK_BOT_TOKEN, userId);
      if (info?.is_admin || info?.is_owner) {
        return true;
      }
    } catch (err: any) {
      await log(env, 'warning', 'admins:isAdmin users.info failed', { error: String(err?.message || err) });
    }
  }

  return false;
}

export async function addAdmin(env: Env, actor: string, userId: string): Promise<{ ok: boolean; message: string }> {
  await ensureAdminsTable(env);
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB
      .prepare('INSERT OR IGNORE INTO admins (user_id, created_at, created_by) VALUES (?, ?, ?)')
      .bind(userId, now, actor)
      .run();
    await log(env, 'info', 'admins:add', { userId, by: actor });
    return { ok: true, message: `Added <@${userId}> as admin.` };
  } catch (err: any) {
    await log(env, 'error', 'admins:add failed', { error: String(err?.message || err) });
    return { ok: false, message: 'Failed to add admin.' };
  }
}

export async function removeAdmin(env: Env, actor: string, userId: string): Promise<{ ok: boolean; message: string }> {
  await ensureAdminsTable(env);
  try {
    await env.DB
      .prepare('DELETE FROM admins WHERE user_id = ?')
      .bind(userId)
      .run();
    await log(env, 'info', 'admins:remove', { userId, by: actor });
    return { ok: true, message: `Removed <@${userId}> from admins.` };
  } catch (err: any) {
    await log(env, 'error', 'admins:remove failed', { error: String(err?.message || err) });
    return { ok: false, message: 'Failed to remove admin.' };
  }
}

export async function listAdmins(env: Env): Promise<string[]> {
  await ensureAdminsTable(env);
  const rows = await env.DB
    .prepare('SELECT user_id FROM admins ORDER BY user_id ASC')
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

export function parseUserId(input: string | undefined): string | null {
  if (!input) {return null;}
  // Accept <@U123>, U123, or @U123
  const trimmed = input.trim();
  const mentionRe = /^<@([A-Z0-9]+)>$/i;
  const atRe = /^@?([A-Z0-9]+)$/i;
  const m1 = mentionRe.exec(trimmed);
  const id1 = m1?.[1];
  if (id1) {return id1;}
  const m2 = atRe.exec(trimmed);
  const id2 = m2?.[1];
  return id2 ?? null;
}
