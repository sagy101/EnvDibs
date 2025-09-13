import { log } from '../services/log';
import type { Env } from '../types';
import { parseChannelId } from '../util/slack_ids';

const SLACK_API = 'https://slack.com/api';

type SlackAPIResponse<T = any> = { ok: boolean; error?: string } & T;

function summarizePayloadForLog(_endpoint: string, payload: any): Record<string, unknown> {
  try {
    return {
      keys: Object.keys(payload || {}),
      has_text: typeof payload?.text === 'string',
      text_len: typeof payload?.text === 'string' ? (payload.text as string).length : undefined,
      has_blocks: Array.isArray(payload?.blocks),
      blocks_count: Array.isArray(payload?.blocks) ? payload.blocks.length : undefined,
      has_view: !!(payload && (payload as any).view),
    };
  } catch {
    return { summarized: true };
  }
}

async function slackApi(env: Env, token: string, endpoint: string, payload: any): Promise<SlackAPIResponse> {
  try {
    const base = (env as any)?.SLACK_API_BASE || SLACK_API;
    const res = await fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as SlackAPIResponse;
    if (!data.ok) {
      const payload_summary = summarizePayloadForLog(endpoint, payload);
      await log(env, 'warning', `Slack API ${endpoint} returned not ok`, { error: data.error, payload_summary });
    } else {
      await log(env, 'info', `Slack API ${endpoint} ok`);
    }
    return data;
  } catch (err: any) {
    await log(env, 'error', `Slack API ${endpoint} failed`, { error: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) } as SlackAPIResponse;
  }
}

export async function viewsOpen(env: Env, triggerId: string, view: any): Promise<boolean> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {return false;}
  const data = await slackApi(env, token, 'views.open', { trigger_id: triggerId, view });
  return !!data.ok;
}

export async function viewsPublish(env: Env, userId: string, view: any): Promise<boolean> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {return false;}
  const data = await slackApi(env, token, 'views.publish', { user_id: userId, view });
  return !!data.ok;
}

export async function viewsUpdate(env: Env, viewId: string, view: any, hash?: string): Promise<boolean> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {return false;}
  const payload: any = { view_id: viewId, view };
  if (hash) { payload.hash = hash; }
  const data = await slackApi(env, token, 'views.update', payload);
  return !!data.ok;
}

export type SlackChannel = { id: string; name: string; is_private?: boolean };

export async function listConversations(env: Env, token: string): Promise<SlackChannel[]> {
  const data = await slackApi(env, token, 'conversations.list', {
    exclude_archived: true,
    types: 'public_channel,private_channel',
    limit: 1000,
  });
  if (!data.ok) {return [];}
  const channels = (data as any).channels as Array<{ id: string; name: string; is_private?: boolean }> | undefined;
  return channels ?? [];
}

export async function resolveChannelId(env: Env, input: string): Promise<string | null> {
  const direct = parseChannelId(input);
  if (direct) {return direct;}
  const name = input.trim().replace(/^#/, '');
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {return null;}
  const chans = await listConversations(env, token);
  const found = chans.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return found?.id ?? null;
}

export async function respondEphemeral(responseUrl: string, text: string, blocks?: any[]): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    });
  } catch {
    // ignore failures silently; interactions should not crash worker
  }
}

export async function sendDMBlocks(env: Env, userId: string, text: string, blocks: any[]): Promise<void> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {
    await log(env, 'warning', 'SLACK_BOT_TOKEN missing; skipping DM send');
    return;
  }
  try {
    const ch = await openImChannel(env, token, userId);
    if (!ch) {
      await log(env, 'warning', 'Failed to open IM channel', { userId });
      return;
    }
    const ok = await postMessageBlocks(env, token, ch, text, blocks);
    if (!ok) {
      await log(env, 'warning', 'chat.postMessage (blocks) returned not ok', { channel: ch });
    } else {
      await log(env, 'info', 'DM (blocks) sent', { userId, channel: ch });
    }
  } catch (err: any) {
    await log(env, 'error', 'sendDMBlocks failed', { error: String(err?.message || err) });
  }
}

export type SlackUser = {
  id: string;
  team_id?: string;
  is_admin?: boolean;
  is_owner?: boolean;
};

export async function getUserInfo(env: Env, token: string, userId: string): Promise<SlackUser | null> {
  const data = await slackApi(env, token, 'users.info', { user: userId });
  if (!data.ok) {return null;}
  const user = (data as any).user as SlackUser | undefined;
  return user ?? null;
}

export async function openImChannel(env: Env, token: string, userId: string): Promise<string | null> {
  const data = await slackApi(env, token, 'conversations.open', { users: userId });
  if (!data.ok) {return null;}
  const channel = (data as any).channel?.id as string | undefined;
  return channel ?? null;
}

export async function postMessage(env: Env, token: string, channel: string, text: string): Promise<boolean> {
  const data = await slackApi(env, token, 'chat.postMessage', { channel, text });
  return !!data.ok;
}

export async function postMessageBlocks(
  env: Env,
  token: string,
  channel: string,
  text: string,
  blocks: any[]
): Promise<boolean> {
  const data = await slackApi(env, token, 'chat.postMessage', { channel, text, blocks });
  return !!data.ok;
}

export async function sendDM(env: Env, userId: string, text: string): Promise<void> {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) {
    await log(env, 'warning', 'SLACK_BOT_TOKEN missing; skipping DM send');
    return;
  }
  try {
    const ch = await openImChannel(env, token, userId);
    if (!ch) {
      await log(env, 'warning', 'Failed to open IM channel', { userId });
      return;
    }
    const ok = await postMessage(env, token, ch, text);
    if (!ok) {
      await log(env, 'warning', 'chat.postMessage returned not ok', { channel: ch });
    } else {
      await log(env, 'info', 'DM sent', { userId, channel: ch });
    }
  } catch (err: any) {
    await log(env, 'error', 'sendDM failed', { error: String(err?.message || err) });
  }
}
