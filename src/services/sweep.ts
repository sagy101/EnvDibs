import { announceIfEnabled } from './announce';
import { getEnvByName } from './envs';
import { log } from './log';
import { purgeOldData } from './retention';
import { getDmEnabled, getDmReminderEnabled, getReminderLeadSeconds, getReminderMinTTLSeconds, getDmExpiryEnabled, getDefaultExtendSeconds } from './settings';
import { sendDM, sendDMBlocks } from '../slack/api';
import { actions, button, section } from '../slack/blocks';
import { freeAnnouncementBlocks, busyAnnouncementBlocks } from '../slack/blocks/announce';
import { slackDate, humanizeSeconds } from '../slack/format';
import type { Env } from '../types';

type ExpiredHoldRow = {
  id: string;
  env_id: string;
  user_id: string;
  expires_at: number;
  name: string;
  default_ttl_seconds: number;
};

export async function scheduledSweep(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Ensure schema is up-to-date for reminders (idempotent)
  try {
    await env.DB.exec('ALTER TABLE holds ADD COLUMN reminded_at INTEGER');
  } catch {
    // Ignore if column already exists
  }
  await log(env, 'info', 'cron: sweep tick start', { now });
  await sendReminders(env, now);
  await releaseExpired(env, now);
  // Optional retention purge (disabled unless retention_days is set)
  await purgeOldData(env, now);
  await log(env, 'info', 'cron: sweep tick end');
}

async function sendReminders(env: Env, now: number): Promise<void> {
  const dmGlobal = await getDmEnabled(env);
  const dmReminders = await getDmReminderEnabled(env);
  if (!(dmGlobal && dmReminders)) {return;} // require both global and reminders to be ON
  // Remind if: not released, no reminder sent, time remaining <= lead, and original TTL >= min threshold
  const lead = await getReminderLeadSeconds(env);
  const minTtl = await getReminderMinTTLSeconds(env);
  const defExt = await getDefaultExtendSeconds(env);
  const rows = await env.DB
    .prepare(
      `SELECT h.id, h.user_id, h.expires_at, h.started_at, e.name
       FROM holds h
       JOIN envs e ON e.id = h.env_id
       WHERE h.released_at IS NULL
         AND h.reminded_at IS NULL
         AND (h.expires_at - ?) > 0
         AND (h.expires_at - ?) <= ?
         AND (h.expires_at - h.started_at) >= ?`
    )
    .bind(now, now, lead, minTtl)
    .all<{ id: string; user_id: string; expires_at: number; started_at: number; name: string }>();

  await log(env, 'info', 'cron: reminder candidates', { count: rows.results.length });
  for (const r of rows.results) {
    const remaining = Math.max(0, r.expires_at - now);
    const text = `Heads up: your hold on \`${r.name}\` will expire at ${slackDate(r.expires_at)} (${humanizeSeconds(remaining)} left).`;
    if (dmGlobal && dmReminders) {
      const blocks = [
        section(text),
        actions([
          button('extend_default', `Extend ${humanizeSeconds(defExt)}`, r.name, 'primary'),
          button('release_now', 'Release now', r.name, 'danger'),
        ]),
      ];
      await sendDMBlocks(env, r.user_id, text, blocks);
    }
    await env.DB
      .prepare('UPDATE holds SET reminded_at = ? WHERE id = ?')
      .bind(now, r.id)
      .run();
    await log(env, 'info', 'cron: reminder processed', { user: r.user_id, env: r.name, expires_at: r.expires_at });
  }
}

async function releaseExpired(env: Env, now: number): Promise<void> {
  const dmEnabled = (await getDmEnabled(env)) && (await getDmExpiryEnabled(env));
  const rows = await env.DB
    .prepare(
      `SELECT h.id, h.env_id, h.user_id, h.expires_at, e.name, e.default_ttl_seconds
       FROM holds h
       JOIN envs e ON e.id = h.env_id
       WHERE h.released_at IS NULL
         AND h.expires_at <= ?`
    )
    .bind(now)
    .all<ExpiredHoldRow>();

  await log(env, 'info', 'cron: expired holds found', { count: rows.results.length });
  for (const r of rows.results) {
    // Release the expired hold
    await env.DB
      .prepare('UPDATE holds SET released_at = ? WHERE id = ?')
      .bind(now, r.id)
      .run();
    await log(env, 'info', 'cron: hold released', { env: r.name, user: r.user_id });

    // Check queue
    const next = await env.DB
      .prepare('SELECT id, user_id, requested_ttl_seconds FROM queue WHERE env_id = ? ORDER BY position ASC LIMIT 1')
      .bind(r.env_id)
      .first<{ id: string; user_id: string; requested_ttl_seconds: number | null }>();

    if (!next) {
      if (dmEnabled) {
        await sendDM(env, r.user_id, `Your hold on \`${r.name}\` expired and the environment is now free.`);
      }
      // Channel announcement: now free (if enabled and channel set)
      const info = await getEnvByName(env, r.name);
      if (info) {
        await announceIfEnabled(
          env,
          info as any,
          `• \`${r.name}\` is now free.`,
          freeAnnouncementBlocks(r.name, `• \`${r.name}\` is now free.`)
        );
      }
      await log(env, 'info', 'cron: no queue, env now free', { env: r.name });
      continue;
    }

    // Remove from queue and assign to next
    await env.DB
      .prepare('DELETE FROM queue WHERE id = ?')
      .bind(next.id)
      .run();

    const requestedOrDefault = next.requested_ttl_seconds || r.default_ttl_seconds;
    const ttl = Math.max(60, Math.min(requestedOrDefault, 3 * 24 * 60 * 60));
    const expires = now + ttl;
    await env.DB
      .prepare('INSERT INTO holds (id, env_id, user_id, started_at, expires_at, note) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), r.env_id, next.user_id, now, expires, 'assigned from queue (auto)')
      .run();
    await log(env, 'info', 'cron: assigned next from queue', { env: r.name, new_user: next.user_id, expires });

    if (dmEnabled) {
      await sendDM(env, r.user_id, `Your hold on \`${r.name}\` expired and was reassigned to the next person in the queue.`);
      await sendDM(env, next.user_id, `You now hold \`${r.name}\` until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`);
    }
    // Channel announcement: reassigned to next (if enabled and channel set)
    {
      const info = await getEnvByName(env, r.name);
      if (info) {
        await announceIfEnabled(
          env,
          info as any,
          `• \`${r.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`,
          busyAnnouncementBlocks(r.name, `• \`${r.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`)
        );
      }
    }
  }
}
