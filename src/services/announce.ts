import type { Env } from '../types';
import type { EnvRow } from './envs';
import { log } from './log';
import { getAnnounceGlobalEnabled } from './settings';
import { postMessage, postMessageBlocks } from '../slack/api';

export async function announceIfEnabled(env: Env, envRow: EnvRow, text: string, blocks?: any[]): Promise<void> {
  try {
    const global = await getAnnounceGlobalEnabled(env);
    const val = envRow.announce_enabled as any;
    const perEnv = val === 1 || val === true || val === '1' || (typeof val === 'string' && val.toLowerCase() === 'true');
    const channelId = envRow.channel_id;
    if (global && perEnv && channelId && env.SLACK_BOT_TOKEN) {
      if (blocks && blocks.length) {
        await postMessageBlocks(env, env.SLACK_BOT_TOKEN as any, channelId, text, blocks);
      } else {
        await postMessage(env, env.SLACK_BOT_TOKEN as any, channelId, text);
      }
      await log(env, 'info', 'announce:sent', { channelId, text });
      
    } else {
      await log(env, 'info', 'announce:skipped', { global, perEnv, hasChannel: Boolean(channelId), hasToken: Boolean(env.SLACK_BOT_TOKEN) });
    }
  } catch (err: any) {
    await log(env, 'warning', 'announce:failed', { error: String(err?.message || err) });
  }
}
