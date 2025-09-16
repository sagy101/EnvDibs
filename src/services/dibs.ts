import { announceIfEnabled } from './announce';
import { withTransaction } from './db';
import { getEnvByName } from './envs';
import { log } from './log';
import { freeAnnouncementBlocks, busyAnnouncementBlocks } from '../slack/blocks/announce';
import { slackDate, humanizeSeconds } from '../slack/format';
import type { Env, ExecutionContext } from '../types';
import { uuid } from '../util/ids';

const MAX_TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days hard cap

export async function dibOn(
  env: Env,
  userId: string,
  envName: string,
  opts?: { requestedSeconds?: number; note?: string },
  ctx?: ExecutionContext
) {
  const info = await getEnvByName(env, envName);
  if (!info) {
    return { ok: false, message: `Environment not found. Ask an admin to add it: /claim add \`${envName}\`` };
  }

  const now = Math.floor(Date.now() / 1000);
  const envCap = info.max_ttl_seconds ?? MAX_TTL_SECONDS;
  // If the user explicitly requested a duration that exceeds the env's max, treat as error
  if (typeof opts?.requestedSeconds === 'number' && opts.requestedSeconds > envCap) {
    await log(env, 'info', 'dib:on requested over max', { env: info.name, user: userId, requested: opts.requestedSeconds, cap: envCap });
    return { ok: false, message: `Requested duration exceeds max TTL for \`${info.name}\`. Max is ${humanizeSeconds(envCap)}.` };
  }
  const ttl = Math.min(opts?.requestedSeconds || info.default_ttl_seconds, envCap, MAX_TTL_SECONDS);
  await log(env, 'info', 'dib:on begin', { env: info.name, user: userId, requested: opts?.requestedSeconds, ttl });

  return withTransaction(env.DB, async () => {
    let active = await env.DB
      .prepare('SELECT id, user_id, expires_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
      .bind(info.id)
      .first<{ id: string; user_id: string; expires_at: number }>();

    if (!active) {
      const id = uuid();
      const expires = now + ttl;
      try {
        await env.DB
          .prepare('INSERT INTO holds (id, env_id, user_id, started_at, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, info.id, userId, now, expires, opts?.note ?? null)
          .run();
        await log(env, 'info', 'dib:on acquired', { env: info.name, user: userId, expires });
        // Channel announcement (opt-in). Re-read env to ensure latest announce/channel settings.
        const fresh = (await getEnvByName(env, info.name)) || info;
        const announceP = announceIfEnabled(
          env,
          fresh as any,
          `• \`${info.name}\` assigned to <@${userId}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`,
          busyAnnouncementBlocks(info.name, `• \`${info.name}\` assigned to <@${userId}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`)
        );
        if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
        return { ok: true, message: `You now hold \`${info.name}\` until ${slackDate(expires)} (${humanizeSeconds(ttl)}).` };
      } catch (err: any) {
        const msg = String(err?.message || err);
        // If another user raced and acquired the hold, fall back to queueing
        if (/unique|constraint/i.test(msg)) {
          // Re-read the active hold and continue to queueing path
          active = await env.DB
            .prepare('SELECT id, user_id, expires_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
            .bind(info.id)
            .first<{ id: string; user_id: string; expires_at: number }>();
          await log(env, 'warning', 'dib:on race detected; falling back to queue', { env: info.name, user: userId });
        } else {
          await log(env, 'error', 'dib:on insert failed', { env: info.name, user: userId, error: msg });
          throw err;
        }
      }
    }

    if (active && active.user_id === userId) {
      const remaining = Math.max(0, active.expires_at - now);
      await log(env, 'info', 'dib:on already-holder', { env: info.name, user: userId, remaining });
      // Mark as error so the router shows this message even when acks are suppressed
      return { ok: false, message: `You already hold \`${info.name}\` (remaining ${humanizeSeconds(remaining)}).` };
    }

    // Enqueue if not already queued
    const existingQ = await env.DB
      .prepare('SELECT id, position FROM queue WHERE env_id = ? AND user_id = ?')
      .bind(info.id, userId)
      .first<{ id: string; position: number }>();

    if (existingQ?.id) {
      await log(env, 'info', 'dib:on already-queued', { env: info.name, user: userId, position: existingQ.position });
      const base = active ? Math.max(0, active.expires_at - now) : 0;
      const eta = base + Math.max(0, existingQ.position - 1) * (info.default_ttl_seconds || 0);
      // Mark as error so user sees the feedback even when acks are suppressed
      return { ok: false, message: `\`${info.name}\` is busy. You are already in the queue at position ${existingQ.position}. ETA ~ ${humanizeSeconds(eta)}.` };
    }

    const posRow = await env.DB
      .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM queue WHERE env_id = ?')
      .bind(info.id)
      .first<{ pos: number }>();
    const position = Number(posRow?.pos ?? 1);

    await env.DB
      .prepare('INSERT INTO queue (id, env_id, user_id, position, enqueued_at, requested_ttl_seconds) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uuid(), info.id, userId, position, now, opts?.requestedSeconds ?? null)
      .run();
    await log(env, 'info', 'dib:on enqueued', { env: info.name, user: userId, position });

    const base = active ? Math.max(0, active.expires_at - now) : 0;
    const eta = base + Math.max(0, position - 1) * (info.default_ttl_seconds || 0);
    if (active) {
      // Queue join is not full success (user asked to claim, not queue),
      // so treat as non-success to ensure it is shown when Acks are OFF.
      return { ok: false, message: `\`${info.name}\` is currently held by <@${active.user_id}> until ${slackDate(active.expires_at)}. You are queued at position ${position}. ETA ~ ${humanizeSeconds(eta)}.` };
    }
    // Fallback message if active unexpectedly missing after conflict
    return { ok: false, message: `\`${info.name}\` is currently busy. You are queued at position ${position}. ETA ~ ${humanizeSeconds(eta)}.` };
  });
}

export async function dibOff(env: Env, userId: string, envName: string, ctx?: ExecutionContext) {
  const info = await getEnvByName(env, envName);
  if (!info) {return { ok: false, message: `Environment not found: \`${envName}\`` };}
  const now = Math.floor(Date.now() / 1000);
  await log(env, 'info', 'dib:off begin', { env: info.name, user: userId });

  return withTransaction(env.DB, async () => {
    const active = await env.DB
      .prepare('SELECT id, user_id, expires_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
      .bind(info.id)
      .first<{ id: string; user_id: string; expires_at: number }>();

    if (active && active.user_id === userId) {
      // Release and assign next if any
      await env.DB
        .prepare('UPDATE holds SET released_at = ? WHERE id = ?')
        .bind(now, active.id)
        .run();
      await log(env, 'info', 'dib:off released', { env: info.name, user: userId });

      const next = await env.DB
        .prepare('SELECT id, user_id, requested_ttl_seconds FROM queue WHERE env_id = ? ORDER BY position ASC LIMIT 1')
        .bind(info.id)
        .first<{ id: string; user_id: string; requested_ttl_seconds: number | null }>();

      if (!next) {
        await log(env, 'info', 'dib:off no-queue', { env: info.name });
        // Announce free
        const announceP = announceIfEnabled(
          env,
          info as any,
          `• \`${info.name}\` is now free.`,
          freeAnnouncementBlocks(info.name, `• \`${info.name}\` is now free.`)
        );
        if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
        return { ok: true, message: `Released \`${info.name}\`. It is now free.` };
      }

      // Remove from queue and assign hold
      await env.DB
        .prepare('DELETE FROM queue WHERE id = ?')
        .bind(next.id)
        .run();

      const ttl = Math.min(next.requested_ttl_seconds || info.default_ttl_seconds, MAX_TTL_SECONDS);
      const expires = now + ttl;
      await env.DB
        .prepare('INSERT INTO holds (id, env_id, user_id, started_at, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(uuid(), info.id, next.user_id, now, expires, `assigned from queue`)
        .run();
      await log(env, 'info', 'dib:off assigned-next', { env: info.name, from: userId, to: next.user_id, expires });
      {
        const announceP = announceIfEnabled(
          env,
          info as any,
          `• \`${info.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`,
          busyAnnouncementBlocks(info.name, `• \`${info.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`)
        );
        if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
      }
      return { ok: true, message: `Released \`${info.name}\`. Assigned to <@${next.user_id}> until ${slackDate(expires)}.` };
    }

    // Not holder — remove from queue if present
    const queued = await env.DB
      .prepare('SELECT id, position FROM queue WHERE env_id = ? AND user_id = ?')
      .bind(info.id, userId)
      .first<{ id: string; position: number }>();

    if (queued?.id) {
      await env.DB
        .prepare('DELETE FROM queue WHERE id = ?')
        .bind(queued.id)
        .run();
      await log(env, 'info', 'dib:off dequeued-self', { env: info.name, user: userId, position: queued.position });
      // Treat as non-success so the confirmation is visible even when Acks are OFF
      return { ok: false, message: `Removed you from the queue for \`${info.name}\`.` };
    }

    if (active) {
      await log(env, 'warning', 'dib:off not-holder', { env: info.name, holder: active.user_id, requester: userId });
      return { ok: false, message: `You do not hold \`${info.name}\`. It is held by <@${active.user_id}> until ${slackDate(active.expires_at)}.` };
    } else {
      await log(env, 'info', 'dib:off already-free', { env: info.name });
      // Consider this a no-op error so users see feedback even when acks are suppressed
      return { ok: false, message: `\`${info.name}\` is already free.` };
    }
  });
}

export async function listEnvironments(env: Env, userId: string, filter: string) {
  const envs = await env.DB
    .prepare('SELECT id, name, default_ttl_seconds FROM envs WHERE is_archived = 0 ORDER BY name ASC')
    .all<{ id: string; name: string; default_ttl_seconds: number }>();
  const now = Math.floor(Date.now() / 1000);

  const lines: string[] = [];
  const header =
    filter === 'mine'
      ? '*Environments (yours)*'
      : filter === 'active'
        ? '*Environments (active)*'
        : filter === 'free'
          ? '*Environments (free)*'
        : '*Environments (all)*';

  const envIds = envs.results.map((e) => e.id);
  const activeByEnv = new Map<string, { user_id: string; expires_at: number }>();
  const queueCountByEnv = new Map<string, number>();
  const queueUsersByEnv = new Map<string, string[]>();
  const inQueueEnvSet = new Set<string>();

  if (envIds.length) {
    const placeholders = envIds.map(() => '?').join(',');
    // Active holds for all envs
    const activeRows = await env.DB
      .prepare(`SELECT env_id, user_id, expires_at FROM holds WHERE released_at IS NULL AND env_id IN (${placeholders})`)
      .bind(...envIds)
      .all<{ env_id: string; user_id: string; expires_at: number }>();
    for (const r of activeRows.results) {
      activeByEnv.set(r.env_id, { user_id: r.user_id, expires_at: r.expires_at });
    }
    // Queue counts for all envs
    const qCountRows = await env.DB
      .prepare(`SELECT env_id, COUNT(*) AS cnt FROM queue WHERE env_id IN (${placeholders}) GROUP BY env_id`)
      .bind(...envIds)
      .all<{ env_id: string; cnt: number }>();
    for (const r of qCountRows.results) {
      queueCountByEnv.set(r.env_id, Number(r.cnt || 0));
    }
    // First few queued users per env (we'll limit to 3 in code)
    const qUserRows = await env.DB
      .prepare(`SELECT env_id, user_id, position FROM queue WHERE env_id IN (${placeholders}) ORDER BY env_id ASC, position ASC`)
      .bind(...envIds)
      .all<{ env_id: string; user_id: string; position: number }>();
    for (const r of qUserRows.results) {
      const arr = queueUsersByEnv.get(r.env_id) || [];
      if (arr.length < 3) {
        arr.push(`<@${r.user_id}>`);
        queueUsersByEnv.set(r.env_id, arr);
      }
    }
    // Envs where current user is in queue (for 'mine')
    if (filter === 'mine') {
      const inQRows = await env.DB
        .prepare(`SELECT env_id FROM queue WHERE user_id = ? AND env_id IN (${placeholders})`)
        .bind(userId, ...envIds)
        .all<{ env_id: string }>();
      for (const r of inQRows.results) {
        inQueueEnvSet.add(r.env_id);
      }
    }
  }

  for (const e of envs.results) {
    const active = activeByEnv.get(e.id) || null;
    const count = queueCountByEnv.get(e.id) || 0;
    const preview = (queueUsersByEnv.get(e.id) || []).join(', ');
    const qSuffix = buildQueueSuffix(Math.min(3, count), preview);

    if (filter === 'mine') {
      const iHold = active?.user_id === userId;
      const inQueue = inQueueEnvSet.has(e.id);
      if (!iHold && !inQueue) {continue;}
    } else if (filter === 'active' && !active) {
      continue;
    } else if (filter === 'free' && active) {
      continue;
    }

    if (active) {
      const remaining = Math.max(0, active.expires_at - now);
      lines.push(`• \`${e.name}\` — *held by* <@${active.user_id}> until ${slackDate(active.expires_at)} (${humanizeSeconds(remaining)} left).${qSuffix}`);
    } else {
      lines.push(`• \`${e.name}\` — *free*. Default TTL: ${humanizeSeconds(e.default_ttl_seconds)}.${qSuffix}`);
    }
  }

  if (lines.length === 0) {
    return { ok: true, text: filter === 'mine' ? 'You have no active holds and are not in any queues.' : 'No environments found.' };
  }
  return { ok: true, text: [header, '', ...lines].join('\n') };
}

function buildQueueSuffix(count: number, preview: string): string {
  if (!count) {return '';}
  const ellipsis = count === 3 ? '…' : '';
  return ` Queue: ${preview}${ellipsis}`;
}

export async function dibExtend(env: Env, userId: string, envName: string, extendSeconds: number) {
  const info = await getEnvByName(env, envName);
  if (!info) {return { ok: false, message: `Environment not found: \`${envName}\`` };}
  const now = Math.floor(Date.now() / 1000);
  const active = await env.DB
    .prepare('SELECT id, user_id, started_at, expires_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
    .bind(info.id)
    .first<{ id: string; user_id: string; started_at: number; expires_at: number }>();
  if (!active) {return { ok: false, message: `\`${info.name}\` is not currently held.` };}
  if (active.user_id !== userId) {return { ok: false, message: `You do not hold \`${info.name}\`.` };}
  if (extendSeconds <= 0) {return { ok: false, message: `Invalid duration to extend.` };}

  const cap = Math.min(info.max_ttl_seconds ?? MAX_TTL_SECONDS, MAX_TTL_SECONDS);
  const used = Math.max(0, active.expires_at - active.started_at);
  const desiredTotal = used + extendSeconds;
  const allowedTotal = Math.min(desiredTotal, cap);
  const newExpires = active.started_at + allowedTotal;

  if (newExpires <= active.expires_at) {
    return { ok: false, message: `Max TTL reached for \`${info.name}\`.` };
  }

  await env.DB
    .prepare('UPDATE holds SET expires_at = ?, reminded_at = NULL WHERE id = ?')
    .bind(newExpires, active.id)
    .run();

  const remaining = Math.max(0, newExpires - now);
  await log(env, 'info', 'dib:extend updated', { env: info.name, user: userId, new_expires: newExpires });
  return { ok: true, message: `Extended \`${info.name}\` to ${slackDate(newExpires)} (${humanizeSeconds(remaining)} left).` };
}

export async function dibInfo(env: Env, userId: string, envName: string) {
  const info = await getEnvByName(env, envName);
  if (!info) {return { ok: false, message: `Environment not found: ${envName}` };}
  const now = Math.floor(Date.now() / 1000);
  const active = await env.DB
    .prepare('SELECT user_id, expires_at, started_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
    .bind(info.id)
    .first<{ user_id: string; expires_at: number; started_at: number }>();
  const q = await env.DB
    .prepare('SELECT user_id FROM queue WHERE env_id = ? ORDER BY position ASC LIMIT 5')
    .bind(info.id)
    .all<{ user_id: string }>();
  const parts: string[] = [];
  parts.push(`*Environment* \`${info.name}\``);
  parts.push(`• Default TTL: ${humanizeSeconds(info.default_ttl_seconds)}`);
  parts.push(`• Max TTL: ${info.max_ttl_seconds ? humanizeSeconds(info.max_ttl_seconds) : '—'}`);
  if (active) {
    const remaining = Math.max(0, active.expires_at - now);
    parts.push(`• Holder: <@${active.user_id}> until ${slackDate(active.expires_at)} (${humanizeSeconds(remaining)} left)`);
  } else {
    parts.push('• Holder: — (free)');
  }
  const queuePreview = q.results.map((r) => `<@${r.user_id}>`).join(', ');
  const qCount = q.results.length || 0;
  let qLine = `• Queue: ${qCount}`;
  if (queuePreview) {
    const ellipsis = qCount >= 5 ? '…' : '';
    qLine += ` (${queuePreview}${ellipsis})`;
  }
  parts.push(qLine);
  return { ok: true, message: parts.join('\n') };
}

export async function forceOff(env: Env, actorId: string, envName: string, ctx?: ExecutionContext) {
  const info = await getEnvByName(env, envName);
  if (!info) {return { ok: false, message: `Environment not found: \`${envName}\`` };}
  const now = Math.floor(Date.now() / 1000);
  return withTransaction(env.DB, async () => {
    const active = await env.DB
      .prepare('SELECT id, user_id FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
      .bind(info.id)
      .first<{ id: string; user_id: string }>();
    if (!active) {return { ok: true, message: `\`${info.name}\` is already free.` };}
    await env.DB
      .prepare('UPDATE holds SET released_at = ? WHERE id = ?')
      .bind(now, active.id)
      .run();

    const next = await env.DB
      .prepare('SELECT id, user_id, requested_ttl_seconds FROM queue WHERE env_id = ? ORDER BY position ASC LIMIT 1')
      .bind(info.id)
      .first<{ id: string; user_id: string; requested_ttl_seconds: number | null }>();
    if (!next) {
      {
        const announceP = announceIfEnabled(
          env,
          info,
          `• \`${info.name}\` is now free.`,
          freeAnnouncementBlocks(info.name, `• \`${info.name}\` is now free.`)
        );
        if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
      }
      return { ok: true, message: `Force released \`${info.name}\`. It is now free.` };
    }
    // Delete queue row and assign
    await env.DB
      .prepare('DELETE FROM queue WHERE id = ?')
      .bind(next.id)
      .run();
    const ttl = Math.min(next.requested_ttl_seconds || info.default_ttl_seconds, MAX_TTL_SECONDS);
    const expires = now + ttl;
    await env.DB
      .prepare('INSERT INTO holds (id, env_id, user_id, started_at, expires_at, note) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uuid(), info.id, next.user_id, now, expires, 'assigned from queue (forced)')
      .run();
    {
      const announceP = announceIfEnabled(
        env,
        info,
        `• \`${info.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`,
        busyAnnouncementBlocks(info.name, `• \`${info.name}\` assigned to <@${next.user_id}> until ${slackDate(expires)} (${humanizeSeconds(ttl)}).`)
      );
      if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
    }
    return { ok: true, message: `Force released \`${info.name}\`. Assigned to <@${next.user_id}>.` };
  });
}

export async function transferHold(env: Env, actorId: string, envName: string, toUserId: string, ctx?: ExecutionContext) {
  const info = await getEnvByName(env, envName);
  if (!info) {return { ok: false, message: `Environment not found: \`${envName}\`` };}
  return withTransaction(env.DB, async () => {
    const active = await env.DB
      .prepare('SELECT id, user_id, expires_at FROM holds WHERE env_id = ? AND released_at IS NULL LIMIT 1')
      .bind(info.id)
      .first<{ id: string; user_id: string; expires_at: number }>();
    if (!active) {return { ok: false, message: `\`${info.name}\` is not currently held.` };}
    await env.DB
      .prepare('UPDATE holds SET user_id = ? WHERE id = ?')
      .bind(toUserId, active.id)
      .run();
    {
      const announceP = announceIfEnabled(
        env,
        info,
        `• \`${info.name}\` transferred to <@${toUserId}> until ${slackDate(active.expires_at)}.`,
        busyAnnouncementBlocks(info.name, `• \`${info.name}\` transferred to <@${toUserId}> until ${slackDate(active.expires_at)}.`)
      );
      if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(announceP); } else { void announceP; }
    }
    return { ok: true, message: `Transferred \`${info.name}\` to <@${toUserId}>.` };
  });
}
