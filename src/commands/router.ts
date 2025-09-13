import { isAdmin, addAdmin as addAdminUser, removeAdmin as removeAdminUser, listAdmins, parseUserId } from '../services/admins';
import { dibOn, dibOff, listEnvironments, dibExtend, dibInfo, forceOff, transferHold } from '../services/dibs';
import { addEnvironment, setDefaultTTL, setEnvAnnounceEnabled, setEnvChannelId, setMaxTTL, archiveEnvironment, renameEnvironment, unarchiveEnvironment } from '../services/envs';
import { getLogLevel, log, normalizeLevel, setLogLevel } from '../services/log';
import { getAnnounceGlobalEnabled, getDmEnabled, getDmExpiryEnabled, getDmReminderEnabled, getReminderLeadSeconds, getReminderMinTTLSeconds, setAnnounceGlobalEnabled, setDmEnabled, setDmExpiryEnabled, setDmReminderEnabled, setReminderLeadSeconds, setReminderMinTTLSeconds, getDefaultExtendSeconds, setDefaultExtendSeconds } from '../services/settings';
import { resolveChannelId, viewsOpen } from '../slack/api';
import { humanizeSeconds } from '../slack/format';
import { buildAdminSettingsModal } from '../slack/modals/admin_settings';
import { ephemeral } from '../slack/respond';
import type { Env, ExecutionContext } from '../types';
import { parseDurationToSeconds } from '../util/durations';
import { parseChannelId } from '../util/slack_ids';
import { buildHelp } from './help';

export type CommandContext = {
  text: string;
  user_id: string;
  channel_id: string;
  team_id: string;
  trigger_id?: string;
};

export async function routeCommand(ctx: CommandContext, env: Env, execCtx?: ExecutionContext) {
  const { text } = ctx;
  const tokens = tokenize(text);
  const primary = tokens.shift()?.toLowerCase();

  if (!primary) {
    const admin = await isAdmin(env, ctx.user_id);
    return ephemeral(buildHelp(admin));
  }

  // Avoid logging raw arguments per privacy policy; record only count
  await log(env, 'info', 'router: dispatch', { user: ctx.user_id, primary, arg_count: tokens.length });

  switch (primary) {
    case 'force-off':
    case 'force': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      if (!name) {
        return ephemeral('Usage: /dib force-off <env>');
      }
      const r = await forceOff(env, ctx.user_id, name, execCtx);
      return ephemeral(r.message);
    }

    case 'transfer': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      const toWord = tokens.shift();
      const userArg = tokens.shift();
      if (!name || toWord !== 'to' || !userArg) {
        return ephemeral('Usage: /dib transfer <env> to <@user|U123>');
      }
      const uid = parseUserId(userArg);
      if (!uid) {
        return ephemeral('Please specify a valid user: <@user> or U123');
      }
      const r = await transferHold(env, ctx.user_id, name, uid, execCtx);
      return ephemeral(r.message);
    }

    case 'archive': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      if (!name) {
        return ephemeral('Usage: /dib archive <env>');
      }
      const r = await archiveEnvironment(env, name);
      return ephemeral(r.message);
    }
    case 'unarchive': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      if (!name) {
        return ephemeral('Usage: /dib unarchive <env>');
      }
      const r = await unarchiveEnvironment(env, name);
      return ephemeral(r.message);
    }
    case 'rename': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      const to = tokens.shift();
      if (!name || !to) {
        return ephemeral('Usage: /dib rename <env> <new-name>');
      }
      const r = await renameEnvironment(env, name, to);
      return ephemeral(r.message);
    }

    case 'announce': {
      await requireAdmin(ctx.user_id, env);
      const sub = tokens.shift();
      if (!sub) {
        const g = await getAnnounceGlobalEnabled(env);
        return ephemeral(`Usage: /dib announce <on|off> | announce <env> <on|off> | announce channel <env> <#channel|C123>. Current: global=${g ? 'on' : 'off'}`);
      }
      if (sub === 'on' || sub === 'off') {
        await setAnnounceGlobalEnabled(env, sub === 'on');
        return ephemeral(`Global announcements are now ${sub}.`);
      }
      if (sub === 'channel') {
        const envName = tokens.shift();
        const chArg = tokens.shift();
        if (!envName || !chArg) {
          return ephemeral('Usage: /dib announce channel <env> <#channel|C123>');
        }
        let chId = parseChannelId(chArg);
        if (!chId) {
          chId = await resolveChannelId(env, chArg);
        }
        if (!chId) {
          return ephemeral('Please select the channel from Slack\'s typeahead (so it becomes a real mention), or paste the channel ID (e.g., C123ABC).');
        }
        const r = await setEnvChannelId(env, envName, chId);
        return ephemeral(r.message);
      }
      // Per-environment toggle
      const envName = sub;
      const state = tokens.shift();
      if (!state || (state !== 'on' && state !== 'off')) {
        return ephemeral('Usage: /dib announce <env> <on|off>');
      }
      const r = await setEnvAnnounceEnabled(env, envName, state === 'on');
      return ephemeral(r.message);
    }
    case 'settings': {
      const sub = tokens[0]?.toLowerCase();
      // If admin requests modal, open settings modal
      if (sub === 'modal') {
        await requireAdmin(ctx.user_id, env);
        if (!ctx.trigger_id) {
          return ephemeral('Unable to open modal (missing trigger_id). Please run from Slack.');
        }
        const view = await buildAdminSettingsModal(env);
        const ok = await viewsOpen(env, ctx.trigger_id, view);
        return ephemeral(ok ? 'Opened admin settings modal.' : 'Failed to open modal.');
      }
      const global = await getDmEnabled(env);
      const rem = await getDmReminderEnabled(env);
      const exp = await getDmExpiryEnabled(env);
      const lead = await getReminderLeadSeconds(env);
      const min = await getReminderMinTTLSeconds(env);
      const defExt = await getDefaultExtendSeconds(env);
      const level = await getLogLevel(env);
      const ann = await getAnnounceGlobalEnabled(env);
      const lines = [
        '*Settings*',
        '────────',
        `• *DMs*: ${global ? 'on' : 'off'}`,
        `• *Reminder DMs*: ${rem ? 'on' : 'off'}`,
        `• *Expiry DMs*: ${exp ? 'on' : 'off'}`,
        `• *Announcements (global)*: ${ann ? 'on' : 'off'}`,
        `• *Reminder lead*: ${humanizeSeconds(lead)}`,
        `• *Reminder min TTL*: ${humanizeSeconds(min)}`,
        `• *Default extend*: ${humanizeSeconds(defExt)}`,
        `• *Log level*: ${level}`,
      ];
      return ephemeral(lines.join('\n'));
    }
    case 'reminders': {
      await requireAdmin(ctx.user_id, env);
      const sub = tokens.shift()?.toLowerCase();
      if (!sub || (sub !== 'lead' && sub !== 'min')) {
        const lead = await getReminderLeadSeconds(env);
        const min = await getReminderMinTTLSeconds(env);
        return ephemeral(`Usage: /dib reminders <lead|min> <duration>. Current: lead=${humanizeSeconds(lead)}, min=${humanizeSeconds(min)}.`);
      }
      const dur = tokens.shift();
      const sec = parseDurationToSeconds(dur || '');
      if (!sec) {return ephemeral('Invalid duration. Example: 10m, 30m, 1h');}
      if (sub === 'lead') {
        await setReminderLeadSeconds(env, sec);
        await log(env, 'info', 'router: reminders set-lead', { seconds: sec, by: ctx.user_id });
        return ephemeral(`Reminder lead set to ${humanizeSeconds(sec)}.`);
      }
      await setReminderMinTTLSeconds(env, sec);
      await log(env, 'info', 'router: reminders set-min', { seconds: sec, by: ctx.user_id });
      return ephemeral(`Reminder minimum TTL set to ${humanizeSeconds(sec)}.`);
    }

    case 'extend-default': {
      await requireAdmin(ctx.user_id, env);
      const dur = tokens.shift();
      if (!dur) {return ephemeral('Usage: /dib extend-default <duration>');}
      const sec = parseDurationToSeconds(dur || '');
      if (!sec) {return ephemeral('Invalid duration. Example: 15m, 30m, 1h');}
      await setDefaultExtendSeconds(env, sec);
      await log(env, 'info', 'router: set default extend', { seconds: sec, by: ctx.user_id });
      return ephemeral(`Default extend set to ${humanizeSeconds(sec)}.`);
    }

    case 'extend': {
      const name = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib extend <env> [for <duration>]');}
      let extendSeconds: number | undefined;
      if (tokens[0] === 'for') {
        tokens.shift();
        const dur = tokens.shift();
        const sec = parseDurationToSeconds(dur || '');
        if (!sec) {return ephemeral('Invalid duration. Example: 30m, 1h');}
        extendSeconds = sec;
      }
      if (!extendSeconds) {
        // Use global default if not specified
        extendSeconds = await getDefaultExtendSeconds(env);
      }
      const resp = await dibExtend(env, ctx.user_id, name, extendSeconds);
      return ephemeral(resp.message);
    }

    case 'info': {
      const name = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib info <env>');}
      const resp = await dibInfo(env, ctx.user_id, name);
      return ephemeral(resp.message);
    }

    case 'set-default': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      const dur = tokens.shift();
      if (!name || !dur) {return ephemeral('Usage: /dib set-default <env> <duration>');}
      const sec = parseDurationToSeconds(dur);
      if (!sec) {return ephemeral('Invalid duration. Example: 2h, 90m');}
      const r = await setDefaultTTL(env, name, sec);
      return ephemeral(r.message);
    }

    case 'set-max': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      const dur = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib set-max <env> <duration|none>');}
      if (!dur) {return ephemeral('Usage: /dib set-max <env> <duration|none>');}
      let sec: number | null = null;
      if (dur.toLowerCase() !== 'none') {
        const parsed = parseDurationToSeconds(dur);
        if (!parsed) {return ephemeral('Invalid duration. Use a value like 2h, 1d, or "none".');}
        sec = parsed;
      }
      const r = await setMaxTTL(env, name, sec);
      return ephemeral(r.message);
    }

    case 'admin': {
      await requireAdmin(ctx.user_id, env);
      const sub = tokens.shift()?.toLowerCase();
      if (!sub || (sub !== 'add' && sub !== 'remove' && sub !== 'list')) {
        return ephemeral('Usage: /dib admin <add|remove|list> [<@user|U123>]');
      }
      if (sub === 'list') {
        const ids = await listAdmins(env);
        return ephemeral(ids.length ? `Admins: ${ids.map((id) => `<@${id}>`).join(', ')}` : 'No dynamic admins.');
      }
      const userArg = tokens.shift();
      const uid = parseUserId(userArg || '');
      if (!uid) {return ephemeral('Please specify a user: /dib admin add <@user>');}
      if (sub === 'add') {
        const r = await addAdminUser(env, ctx.user_id, uid);
        return ephemeral(r.message);
      }
      const r = await removeAdminUser(env, ctx.user_id, uid);
      return ephemeral(r.message);
    }
    case 'log': {
      await requireAdmin(ctx.user_id, env);
      const val = tokens.shift();
      if (!val) {
        const cur = await getLogLevel(env);
        return ephemeral(`Current log level: ${cur}. Usage: /dib log <info|warning|error>`);
      }
      const lvl = normalizeLevel(val);
      if (!lvl) {return ephemeral('Invalid level. Use: info | warning | error');}
      await setLogLevel(env, lvl);
      await log(env, 'info', 'router: log level changed', { level: lvl, by: ctx.user_id });
      return ephemeral(`Log level set to ${lvl}.`);
    }
    case 'dms': {
      await requireAdmin(ctx.user_id, env);
      const sub = tokens.shift()?.toLowerCase();
      if (!sub) {
        const global = await getDmEnabled(env);
        const rem = await getDmReminderEnabled(env);
        const exp = await getDmExpiryEnabled(env);
        return ephemeral(`Usage: /dib dms <on|off> | dms reminder <on|off> | dms expiry <on|off> (admin).\nCurrent: global=${global ? 'on' : 'off'}, reminder=${rem ? 'on' : 'off'}, expiry=${exp ? 'on' : 'off'}`);
      }
      if (sub === 'reminder' || sub === 'expiry') {
        const state = tokens.shift()?.toLowerCase();
        if (!state || (state !== 'on' && state !== 'off')) {
          const rem = await getDmReminderEnabled(env);
          const exp = await getDmExpiryEnabled(env);
          return ephemeral(`Usage: /dib dms ${sub} <on|off>. Current: reminder=${rem ? 'on' : 'off'}, expiry=${exp ? 'on' : 'off'}`);
        }
        if (sub === 'reminder') {
          await setDmReminderEnabled(env, state === 'on');
          await log(env, 'info', 'router: dms reminder toggled', { state, by: ctx.user_id });
          return ephemeral(`Reminder DMs are now ${state}.`);
        }
        await setDmExpiryEnabled(env, state === 'on');
        await log(env, 'info', 'router: dms expiry toggled', { state, by: ctx.user_id });
        return ephemeral(`Expiry DMs are now ${state}.`);
      }
      if (sub === 'on' || sub === 'off') {
        await setDmEnabled(env, sub === 'on');
        await log(env, 'info', 'router: dms global toggled', { state: sub, by: ctx.user_id });
        return ephemeral(`Global DMs are now ${sub}.`);
      }
      const global = await getDmEnabled(env);
      const rem = await getDmReminderEnabled(env);
      const exp = await getDmExpiryEnabled(env);
      return ephemeral(`Unknown option. Usage: /dib dms <on|off> | dms reminder <on|off> | dms expiry <on|off>. Current: global=${global ? 'on' : 'off'}, reminder=${rem ? 'on' : 'off'}, expiry=${exp ? 'on' : 'off'}`);
    }
    case 'add': {
      await requireAdmin(ctx.user_id, env);
      const name = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib add <env> [default <duration>] [desc <text>]');}
      let defaultSeconds: number | undefined;
      let desc: string | undefined;
      while (tokens.length) {
        const key = tokens.shift();
        if (!key) {break;}
        if (key === 'default') {
          const dur = tokens.shift();
          const sec = parseDurationToSeconds(dur || '');
          if (!sec) {return ephemeral('Invalid duration for default. Example: 2h, 90m, 1d');}
          defaultSeconds = sec;
        } else if (key === 'desc') {
          desc = tokens.join(' ');
          break;
        } else {
          await log(env, 'warning', 'router: add unknown option', { option: key });
          return ephemeral(`Unknown option: ${key}`);
        }
      }
      await log(env, 'info', 'router: add env', { name, defaultSeconds, hasDesc: Boolean(desc) });
      const result = await addEnvironment(env, ctx.user_id, name, { defaultSeconds, description: desc });
      return ephemeral(result.message);
    }

    case 'on': {
      const name = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib on <env> [for <duration>] [note <text>]');}
      let requestedSeconds: number | undefined;
      let note: string | undefined;
      while (tokens.length) {
        const key = tokens.shift();
        if (!key) {break;}
        if (key === 'for') {
          const dur = tokens.shift();
          const sec = parseDurationToSeconds(dur || '');
          if (!sec) {return ephemeral('Invalid duration. Example: 2h, 90m, 1d');}
          requestedSeconds = sec;
        } else if (key === 'note') {
          note = tokens.join(' ');
          break;
        } else {
          await log(env, 'warning', 'router: on unknown option', { option: key });
          return ephemeral(`Unknown option: ${key}`);
        }
      }
      await log(env, 'info', 'router: on env', { name, requestedSeconds, hasNote: Boolean(note) });
      const resp = await dibOn(env, ctx.user_id, name, { requestedSeconds, note }, execCtx);
      return ephemeral(resp.message);
    }

    case 'off': {
      const name = tokens.shift();
      if (!name) {return ephemeral('Usage: /dib off <env>');}
      await log(env, 'info', 'router: off env', { name });
      const resp = await dibOff(env, ctx.user_id, name, execCtx);
      return ephemeral(resp.message);
    }

    case 'list': {
      const filter = tokens.shift() || 'all';
      await log(env, 'info', 'router: list', { filter });
      const resp = await listEnvironments(env, ctx.user_id, filter);
      return ephemeral(resp.text);
    }

    default: {
      const admin = await isAdmin(env, ctx.user_id);
      return ephemeral(buildHelp(admin));
    }
  }
}

async function requireAdmin(userId: string, env: Env) {
  const ok = await isAdmin(env, userId);
  if (!ok) {throw new Error('Only admins can perform this action.');}
}

function tokenize(s: string): string[] {
  if (!s) {return [];}
  // Simple split by whitespace; later we can support quoted strings if needed
  return s.trim().split(/\s+/);
}

// help implementation moved to ./help.ts
