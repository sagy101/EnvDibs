/*
 EnvDibs Worker (TypeScript) — Phase 1 scaffold
 - Verifies Slack request signatures
 - /slack/commands: routes /dib commands to handlers (add, on, off, list)
 - Uses Cloudflare D1 for storage
*/

import { routeCommand } from './commands/router';
import { publishHomeThrottled } from './interactive/home';
import { routeInteractive } from './interactive/router';
import { addEnvironment, getEnvByName } from './services/envs';
import { log } from './services/log';
import { initSchema } from './services/schema';
import { scheduledSweep } from './services/sweep';
import { jsonResponse, ok } from './slack/respond';
import { verifySlackRequest } from './slack/verify';
import type { Env, ExecutionContext } from './types';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('EnvDibs TS Worker up. POST /slack/commands for slash commands.', { status: 200 });
    }

    // Slack HTTP stub for tests (keeps real code path via fetch)
    if (url.pathname.startsWith('/__slack/') && (url.hostname === 'test' || (env as any)?.ALLOW_TEST === 'true')) {
      return handleSlackStub(request, env, url.pathname.replace('/__slack/', ''));
    }

    if (url.pathname === '/slack/commands' && request.method === 'POST') {
      return handleSlashCommand(request, env, _ctx);
    }

    if (url.pathname === '/slack/events' && request.method === 'POST') {
      return handleEvents(request, env, _ctx);
    }

    if (url.pathname === '/slack/interactive' && request.method === 'POST') {
      return handleInteractive(request, env, _ctx);
    }

    // Test-only helpers
    const isTest = ((env as any)?.ALLOW_TEST === 'true') || url.hostname === 'test';
    if (isTest) {
      if (url.pathname === '/test/reset' && request.method === 'POST') {
        return handleTestReset(env);
      }
      if (url.pathname === '/test/seed' && request.method === 'POST') {
        return handleTestSeed(request, env);
      }
      if (url.pathname === '/test/command' && request.method === 'POST') {
        return handleTestCommand(request, env, _ctx);
      }
      if (url.pathname === '/test/cron' && request.method === 'POST') {
        return handleTestCron(env);
      }
      if (url.pathname === '/test/interactive' && request.method === 'POST') {
        return handleTestInteractive(request, env, _ctx);
      }
      if (url.pathname === '/test/slack/reset' && request.method === 'POST') {
        return handleTestSlackReset(env);
      }
      if (url.pathname === '/test/slack/peek' && request.method === 'GET') {
        return handleTestSlackPeek(env);
      }
      if (url.pathname === '/test/hold/expires' && request.method === 'POST') {
        return handleTestSetExpires(request, env);
      }
      if (url.pathname === '/test/apphome' && request.method === 'POST') {
        return handleTestAppHome(request, env);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
  async scheduled(_event: any, env: Env, _ctx: ExecutionContext): Promise<void> {
    await scheduledSweep(env);
  },
};

async function handleSlashCommand(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verification = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET);
  if (!verification.verified) {
    return jsonResponse({ error: 'invalid_signature', reason: verification.reason }, 401);
  }

  const params = new URLSearchParams(verification.rawBody);
  const command = params.get('command') || '';
  const user_id = params.get('user_id') || '';
  const channel_id = params.get('channel_id') || '';
  const team_id = params.get('team_id') || '';
  const text = (params.get('text') || '').trim();
  const trigger_id = params.get('trigger_id') || undefined;

  // Avoid logging raw user-entered text per privacy policy
  await log(env, 'info', 'slash: received', { command, user_id, channel_id });
  // Only handle /dib
  if (command !== '/dib') {
    await log(env, 'warning', 'slash: unsupported command', { command });
    return jsonResponse({ response_type: 'ephemeral', text: 'Unsupported command. Use /dib.' });
  }

  try {
    const result = await routeCommand({ text, user_id, channel_id, team_id, trigger_id }, env, ctx);
    await log(env, 'info', 'slash: handled /dib', { user_id, channel_id });
    return jsonResponse(result);
  } catch (err: any) {
    await log(env, 'error', 'slash: unhandled error', { error: String(err?.message || err) });
    return jsonResponse({ response_type: 'ephemeral', text: `Error: ${err?.message || 'unknown'}` }, 200);
  }
}

async function handleEvents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verification = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET);
  if (!verification.verified) {
    return jsonResponse({ error: 'invalid_signature', reason: verification.reason }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(verification.rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  if (payload && payload.type === 'url_verification' && payload.challenge) {
    return jsonResponse({ challenge: payload.challenge }, 200);
  }

  // Handle events asynchronously
  try {
    if (payload && payload.type === 'event_callback' && payload.event) {
      const ev = payload.event;
      if (ev.type === 'app_home_opened' && ev.user) {
        await log(env, 'info', 'events: app_home_opened', { user: ev.user, tab: ev.tab });
        ctx.waitUntil(publishHomeThrottled(env, ev.user as string));
      }
    }
  } catch (err: any) {
    await log(env, 'warning', 'events: handler failed', { error: String(err?.message || err) });
  }
  return ok();
}

async function handleInteractive(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const verification = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET);
  if (!verification.verified) {
    return jsonResponse({ error: 'invalid_signature', reason: verification.reason }, 401);
  }
  // Parse payload=... form body
  const params = new URLSearchParams(verification.rawBody);
  const payloadRaw = params.get('payload') || '';
  let payload: any = null;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    await log(env, 'warning', 'interactive: invalid json payload');
  }
  // Ack immediately; process in background
  if (payload) {
    ctx.waitUntil(routeInteractive(env, payload));
  }
  return new Response('', { status: 200 });
}

// Slack HTTP stub endpoints used only in tests
async function handleSlackStub(request: Request, env: Env, endpoint: string): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    switch (endpoint) {
      case 'views.publish': {
        const userId = body.user_id || body.user || 'U_TEST';
        await recordTestSlackEvent(env, { type: 'view', user_id: String(userId), blocks: body.view ?? {} });
        return jsonResponse({ ok: true });
      }
      case 'views.update': {
        const userId = body.user_id || body.user || 'U_TEST';
        await recordTestSlackEvent(env, { type: 'view', user_id: String(userId), blocks: body.view ?? {} });
        return jsonResponse({ ok: true });
      }
      case 'chat.postMessage': {
        const channel = String(body.channel || 'C_TEST');
        await recordTestSlackEvent(env, { type: 'message', channel, text: String(body.text || ''), blocks: body.blocks });
        return jsonResponse({ ok: true, ts: String(Date.now()) });
      }
      case 'conversations.open': {
        const users = String(body.users || 'U_TEST');
        return jsonResponse({ ok: true, channel: { id: `D_FAKE_${users}` } });
      }
      case 'conversations.list': {
        return jsonResponse({ ok: true, channels: [] });
      }
      case 'users.info': {
        const uid = String(body.user || 'U_TEST');
        const staticAdmins = String((env as any).ADMIN_USERS || '').split(',').map((s) => s.trim()).filter(Boolean);
        const isAdmin = staticAdmins.includes(uid);
        return jsonResponse({ ok: true, user: { id: uid, is_admin: isAdmin, is_owner: false } });
      }
      default:
        return jsonResponse({ ok: false, error: 'unknown_endpoint' }, 404);
    }
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Test helpers (only enabled when env.ALLOW_TEST === 'true')
async function handleTestReset(env: Env): Promise<Response> {
  try {
    await initSchema(env);
    await env.DB.exec(`DELETE FROM holds; DELETE FROM queue; DELETE FROM envs; DELETE FROM settings; DELETE FROM admins;`);
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

async function handleTestSeed(request: Request, env: Env): Promise<Response> {
  try {
    await initSchema(env);
    const body = await request.json().catch(() => ({}));
    const envs: Array<{ name: string; defaultSeconds?: number; description?: string }> = body.envs || [];
    for (const e of envs) {
      await addEnvironment(env, 'U_TEST', e.name, { defaultSeconds: e.defaultSeconds, description: e.description });
    }
    // Ensure default admin exists for tests
    const now = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare('INSERT OR IGNORE INTO admins (user_id, created_at, created_by) VALUES (?, ?, ?)')
      .bind('U_ADMIN', now, 'U_TEST')
      .run();
    return jsonResponse({ ok: true, count: envs.length });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Test helper: route a text command without Slack signature
async function handleTestCommand(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const text: string = String(body.text || '').trim();
    const user_id: string = body.user_id || 'U_TEST';
    const channel_id: string = body.channel_id || 'D_TEST';
    const team_id: string = body.team_id || 'T_TEST';
    const trigger_id: string | undefined = body.trigger_id || undefined;
    await initSchema(env);
    if (!(env as any).ADMIN_USERS) {
      (env as any).ADMIN_USERS = 'U_ADMIN';
    }
    const result = await routeCommand({ text, user_id, channel_id, team_id, trigger_id }, env, ctx);
    return jsonResponse(result);
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Test helper: run cron sweep immediately
async function handleTestCron(env: Env): Promise<Response> {
  try {
    await scheduledSweep(env);
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Test helper: route interactive payload directly (no Slack verification)
async function handleTestInteractive(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const payload = await request.json().catch(() => null);
    if (payload) {
      // In tests, run synchronously so assertions can observe effects immediately
      await routeInteractive(env, payload);
    }
    return new Response('', { status: 200 });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

async function handleTestSlackReset(env: Env): Promise<Response> {
  try {
    await env.DB.exec('DELETE FROM test_slack_events;');
  } catch {
    // ignore if table does not exist
  }
  return jsonResponse({ ok: true });
}

async function handleTestSlackPeek(env: Env): Promise<Response> {
  try {
    const rows = await env.DB
      .prepare('SELECT type, channel, user_id, text, blocks FROM test_slack_events ORDER BY ts ASC')
      .all<{ type: string; channel: string | null; user_id: string | null; text: string | null; blocks: string | null }>();
    const messages = [] as Array<{ type: 'message'; channel: string; text: string; blocks?: any[] }>;
    const dms = [] as Array<{ type: 'dm'; userId: string; text: string; blocks?: any[] }>;
    const views = [] as Array<{ type: 'view'; userId: string; view: any }>;
    for (const r of rows.results) {
      const blocks = r.blocks ? JSON.parse(r.blocks) : undefined;
      if (r.type === 'message' && r.channel) {
        messages.push({ type: 'message', channel: r.channel, text: r.text || '', blocks });
      } else if (r.type === 'dm' && r.user_id) {
        dms.push({ type: 'dm', userId: r.user_id, text: r.text || '', blocks });
      } else if (r.type === 'view' && r.user_id) {
        views.push({ type: 'view', userId: r.user_id, view: blocks });
      }
    }
    return jsonResponse({ ok: true, messages, dms, views });
  } catch {
    return jsonResponse({ ok: true, messages: [], dms: [], views: [] });
  }
}

// --- Test slack events D1 helpers ---
async function ensureTestSlackTable(env: Env): Promise<void> {
  try {
    await env.DB
      .prepare(
        'CREATE TABLE IF NOT EXISTS test_slack_events (id TEXT PRIMARY KEY, type TEXT, channel TEXT, user_id TEXT, text TEXT, blocks TEXT, ts INTEGER)'
      )
      .run();
  } catch {
    // ignore
  }
}

async function recordTestSlackEvent(env: Env, row: { type: 'message' | 'dm' | 'view'; channel?: string; user_id?: string; text?: string; blocks?: any }): Promise<void> {
  await ensureTestSlackTable(env);
  const ts = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare('INSERT INTO test_slack_events (id, type, channel, user_id, text, blocks, ts) VALUES (hex(randomblob(16)), ?, ?, ?, ?, ?, ?)')
    .bind(row.type, row.channel ?? null, row.user_id ?? null, row.text ?? null, row.blocks ? JSON.stringify(row.blocks) : null, ts)
    .run();
}

// Test helper: set active hold expires (and optionally started span)
async function handleTestSetExpires(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const name: string = body.env || body.name;
    const info = await getEnvByName(env, name);
    if (!info) {return jsonResponse({ ok: false, error: 'env_not_found' }, 404);}
    const now = Math.floor(Date.now() / 1000);
    const expiresAt: number = body.expires_at ?? (typeof body.expires_in === 'number' ? now + Number(body.expires_in) : now);
    const startedSpan: number | undefined = typeof body.started_span === 'number' ? Number(body.started_span) : undefined;
    if (startedSpan && startedSpan > 0) {
      const startedAt = Math.max(0, expiresAt - startedSpan);
      await env.DB
        .prepare('UPDATE holds SET expires_at = ?, started_at = ? WHERE env_id = ? AND released_at IS NULL')
        .bind(expiresAt, startedAt, info.id)
        .run();
    } else {
      await env.DB
        .prepare('UPDATE holds SET expires_at = ? WHERE env_id = ? AND released_at IS NULL')
        .bind(expiresAt, info.id)
        .run();
    }
    return jsonResponse({ ok: true, expires_at: expiresAt });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}

// Test helper: publish App Home for a user id
async function handleTestAppHome(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const userId: string = body.user_id || 'U_TEST';
    await publishHomeThrottled(env, userId);
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
}
