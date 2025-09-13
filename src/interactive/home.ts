import { log } from '../services/log';
import { viewsPublish } from '../slack/api';
import { section, actions, button, divider } from '../slack/blocks';
import { slackDate, humanizeSeconds } from '../slack/format';
import type { Env } from '../types';

export async function publishHome(env: Env, userId: string): Promise<void> {
  try {
    const view = await buildHomeView(env, userId);
    await viewsPublish(env, userId, view);
    await log(env, 'info', 'home:published', { user: userId });
  } catch (err: any) {
    await log(env, 'error', 'home:publish_failed', { error: String(err?.message || err) });
  }
}

// Simple per-user throttle to avoid flooding Slack with rapid views.publish updates
const lastPublishAt = new Map<string, number>();

export async function publishHomeThrottled(env: Env, userId: string, windowMs = 600): Promise<void> {
  const now = Date.now();
  const last = lastPublishAt.get(userId) ?? 0;
  if (now - last < windowMs) {
    return; // drop extra publishes in the throttle window
  }
  lastPublishAt.set(userId, now);
  await publishHome(env, userId);
}

export async function buildHomeView(env: Env, userId: string): Promise<any> {
  const now = Math.floor(Date.now() / 1000);
  const defExtend = await (await import('../services/settings')).getDefaultExtendSeconds(env);

  // My Holds
  const myHolds = await env.DB
    .prepare(`
      SELECT e.name AS env_name, h.expires_at
      FROM holds h
      JOIN envs e ON e.id = h.env_id
      WHERE h.user_id = ? AND h.released_at IS NULL
      ORDER BY e.name ASC
    `)
    .bind(userId)
    .all<{ env_name: string; expires_at: number }>();

  // My Queue
  const myQueue = await env.DB
    .prepare(`
      SELECT e.id AS env_id, e.name AS env_name, e.default_ttl_seconds, q.position
      FROM queue q
      JOIN envs e ON e.id = q.env_id
      WHERE q.user_id = ?
      ORDER BY q.position ASC
    `)
    .bind(userId)
    .all<{ env_id: string; env_name: string; default_ttl_seconds: number; position: number }>();

  // Preload active holds for queued envs to compute ETA without N+1 queries
  const queuedEnvIds = (myQueue.results || []).map((q) => q.env_id);
  const activeForQueued = new Map<string, { expires_at: number }>();
  if (queuedEnvIds.length) {
    const placeholders = queuedEnvIds.map(() => '?').join(',');
    const rows = await env.DB
      .prepare(`SELECT env_id, expires_at FROM holds WHERE released_at IS NULL AND env_id IN (${placeholders})`)
      .bind(...queuedEnvIds)
      .all<{ env_id: string; expires_at: number }>();
    for (const r of rows.results) {
      activeForQueued.set(r.env_id, { expires_at: r.expires_at });
    }
  }

  // All Envs (compact overview)
  const envs = await env.DB
    .prepare(`
      SELECT id, name, default_ttl_seconds
      FROM envs
      WHERE is_archived = 0
      ORDER BY name ASC
      LIMIT 25
    `)
    .all<{ id: string; name: string; default_ttl_seconds: number }>();

  // Batch preload active holds and queue counts for these envs
  const envIds = (envs.results || []).map((e) => e.id);
  const activeByEnv = new Map<string, { user_id: string; expires_at: number }>();
  const queueCountByEnv = new Map<string, number>();
  if (envIds.length) {
    const placeholders = envIds.map(() => '?').join(',');
    const activeRows = await env.DB
      .prepare(`SELECT env_id, user_id, expires_at FROM holds WHERE released_at IS NULL AND env_id IN (${placeholders})`)
      .bind(...envIds)
      .all<{ env_id: string; user_id: string; expires_at: number }>();
    for (const r of activeRows.results) {
      activeByEnv.set(r.env_id, { user_id: r.user_id, expires_at: r.expires_at });
    }
    const qRows = await env.DB
      .prepare(`SELECT env_id, COUNT(*) AS cnt FROM queue WHERE env_id IN (${placeholders}) GROUP BY env_id`)
      .bind(...envIds)
      .all<{ env_id: string; cnt: number }>();
    for (const r of qRows.results) {
      queueCountByEnv.set(r.env_id, Number(r.cnt || 0));
    }
  }

  const blocks: any[] = [];

  // Header with Refresh and default extend summary
  blocks.push(section('*EnvDibs — App Home*'));
  blocks.push(actions([
    button('refresh_home', 'Refresh', 'refresh'),
  ]));
  blocks.push(section(`_Default extend_: ${humanizeSeconds(defExtend)}`));
  blocks.push(divider());

  // My Holds Section
  if ((myHolds.results?.length || 0) > 0) {
    blocks.push(section('*My Holds*'));
    for (const h of myHolds.results) {
      blocks.push(section(`• \`${h.env_name}\` — until ${slackDate(h.expires_at)}`));
      blocks.push(
        actions([
          button('extend_default', `Extend ${humanizeSeconds(defExtend)}`, h.env_name, 'primary'),
          button('release_now', 'Release', h.env_name, 'danger'),
          button('env_info', 'Info', h.env_name),
        ])
      );
    }
  } else {
    blocks.push(section('*My Holds*\nYou have no active holds.'));
  }

  blocks.push(divider());

  // My Queue Section
  if ((myQueue.results?.length || 0) > 0) {
    blocks.push(section('*My Queue*'));
    for (const q of myQueue.results) {
      // ETA approximation: time until current hold ends + (position-1) * default TTL
      const active = activeForQueued.get(q.env_id);
      const base = active ? Math.max(0, active.expires_at - now) : 0;
      const eta = base + Math.max(0, q.position - 1) * (q.default_ttl_seconds || 0);
      blocks.push(section(`• \`${q.env_name}\` — position ${q.position} • ETA ~ ${humanizeSeconds(eta)}`));
      blocks.push(actions([
        button('leave_queue', 'Leave queue', q.env_name, 'danger'),
        button('env_info', 'Info', q.env_name),
      ]));
    }
  } else {
    blocks.push(section('*My Queue*\nYou are not in any queues.'));
  }

  blocks.push(divider());

  // All Envs overview
  blocks.push(section('*All Envs*'));
  for (const e of envs.results) {
    const active = activeByEnv.get(e.id) || null;
    const qCount = queueCountByEnv.get(e.id) ?? 0;

    if (active) {
      blocks.push(
        section(`• \`${e.name}\` — held by <@${active.user_id}> until ${slackDate(active.expires_at)}. Queue: ${qCount}`)
      );
      blocks.push(actions([
        button('join_queue', 'Join queue', e.name, 'primary'),
        button('env_info', 'Info', e.name),
      ]));
    } else {
      blocks.push(section(`• \`${e.name}\` — free. Default TTL: ${humanizeSeconds(e.default_ttl_seconds)}. Queue: ${qCount}`));
      blocks.push(
        actions([
          button('dibs_on_open', 'Dibs on…', e.name, 'primary'),
          button('env_info', 'Info', e.name),
        ])
      );
    }
  }

  const view = {
    type: 'home',
    blocks,
  };
  return view;
}
