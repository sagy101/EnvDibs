import { publishHomeThrottled } from './home';
import { dibExtend, dibOff, dibInfo, dibOn } from '../services/dibs';
import { getEnvByName, renameEnvironment, setDefaultTTL, setEnvAnnounceEnabled, setEnvChannelId, setMaxTTL } from '../services/envs';
import { log, normalizeLevel, setLogLevel } from '../services/log';
import { setAnnounceGlobalEnabled, setDmEnabled, setDmExpiryEnabled, setDmReminderEnabled, setReminderLeadSeconds, setReminderMinTTLSeconds, getDefaultExtendSeconds, setDefaultExtendSeconds } from '../services/settings';
import { respondEphemeral, sendDM, viewsOpen, viewsUpdate } from '../slack/api';
import {
  ADMIN_SETTINGS_CALLBACK_ID,
  GL_DM_BLOCK, GL_DM_ACTION,
  GL_REM_BLOCK, GL_REM_ACTION,
  GL_EXP_BLOCK, GL_EXP_ACTION,
  GL_ANN_BLOCK, GL_ANN_ACTION,
  GL_LEAD_BLOCK, GL_LEAD_ACTION,
  GL_MIN_BLOCK, GL_MIN_ACTION,
  GL_LOG_BLOCK, GL_LOG_ACTION,
  GL_EXT_BLOCK, GL_EXT_ACTION,
  ENV_SELECT_BLOCK, ENV_SELECT_ACTION,
  ENV_DEF_BLOCK, ENV_DEF_ACTION,
  ENV_MAX_BLOCK, ENV_MAX_ACTION,
  ENV_REN_BLOCK, ENV_REN_ACTION,
  ENV_ANN_BLOCK, ENV_ANN_ACTION,
  ENV_CH_BLOCK, ENV_CH_ACTION,
} from '../slack/modals/admin_settings';
import { buildDibsOnModal, DIBS_ON_CALLBACK_ID, DURATION_BLOCK_ID, DURATION_ACTION_ID, NOTE_BLOCK_ID, NOTE_ACTION_ID } from '../slack/modals/dibs_on';
import type { Env } from '../types';
import { parseDurationToSeconds } from '../util/durations';

// Handle Slack interactivity: block actions, modals (future)
export async function routeInteractive(env: Env, payload: any): Promise<void> {
  try {
    if (!payload || typeof payload !== 'object') {
      await log(env, 'warning', 'interactive: invalid payload');
      return;
    }
    const type = payload.type as string | undefined;
    const userId = payload.user?.id as string | undefined;

    if (type === 'block_actions' && Array.isArray(payload.actions) && userId) {
      for (const action of payload.actions) {
        const actionId = action?.action_id as string | undefined;
        // Many of our actions use 'value' to pass env name
        let value = (action?.value as string | undefined) || '';
        // For static_select (admin modal), env is in selected_option.value
        if (!value && action?.selected_option?.value) {
          value = String(action.selected_option.value);
        }
        const envName = (value || '').trim();
        if (!actionId) {continue;}

        switch (actionId) {
          case ENV_SELECT_ACTION: {
            // Update admin settings modal with selected env values
            const viewId = payload.view?.id as string | undefined;
            const viewHash = payload.view?.hash as string | undefined;
            if (viewId && envName) {
              const view = await (await import('../slack/modals/admin_settings')).buildAdminSettingsModal(env, envName);
              await viewsUpdate(env, viewId, view, viewHash);
            }
            break;
          }
          case GL_DM_ACTION: {
            // Live-toggle DM-dependent controls in the modal
            const viewId = payload.view?.id as string | undefined;
            const viewHash = payload.view?.hash as string | undefined;
            const dmVal = (action as any)?.selected_option?.value as string | undefined;
            const dmOn = dmVal === 'on';
            // Preserve current env selection (if any)
            const selEnv = payload.view?.state?.values?.[ENV_SELECT_BLOCK]?.[ENV_SELECT_ACTION]?.selected_option?.value as string | undefined;
            if (viewId) {
              const view = await (await import('../slack/modals/admin_settings')).buildAdminSettingsModal(env, selEnv, { dmOverride: dmOn });
              await viewsUpdate(env, viewId, view, viewHash);
            }
            break;
          }
          case 'extend_15m': // backward-compat for older messages
          case 'extend_default': {
            const def = await getDefaultExtendSeconds(env);
            await log(env, 'info', 'interactive: extend_default', { env: envName, user: userId, seconds: def });
            const res = await dibExtend(env, userId, envName, def);
            await sendDM(env, userId, res.message);
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'refresh_home': {
            await log(env, 'info', 'interactive: refresh_home', { user: userId });
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'dibs_on_open': {
            await log(env, 'info', 'interactive: dibs_on_open', { env: envName, user: userId });
            const triggerId = payload.trigger_id as string | undefined;
            const info = await getEnvByName(env, envName);
            if (triggerId) {
              await viewsOpen(env, triggerId, buildDibsOnModal(envName, info?.default_ttl_seconds));
            } else {
              await log(env, 'warning', 'interactive: missing trigger_id for dibs_on_open');
            }
            break;
          }
          case 'release_now': {
            await log(env, 'info', 'interactive: release_now', { env: envName, user: userId });
            const res = await dibOff(env, userId, envName);
            await sendDM(env, userId, res.message);
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'dibs_on_default': {
            await log(env, 'info', 'interactive: dibs_on_default', { env: envName, user: userId });
            const res = await dibOn(env, userId, envName);
            if (payload.response_url) {
              await respondEphemeral(payload.response_url, res.message);
            } else {
              await sendDM(env, userId, res.message);
            }
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'join_queue': {
            await log(env, 'info', 'interactive: join_queue', { env: envName, user: userId });
            const res = await dibOn(env, userId, envName);
            if (payload.response_url) {
              await respondEphemeral(payload.response_url, res.message);
            } else {
              await sendDM(env, userId, res.message);
            }
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'leave_queue': {
            await log(env, 'info', 'interactive: leave_queue', { env: envName, user: userId });
            const res = await dibOff(env, userId, envName);
            if (payload.response_url) {
              await respondEphemeral(payload.response_url, res.message);
            } else {
              await sendDM(env, userId, res.message);
            }
            await publishHomeThrottled(env, userId);
            break;
          }
          case 'env_info': {
            await log(env, 'info', 'interactive: env_info', { env: envName, user: userId });
            const res = await dibInfo(env, userId, envName);
            if (payload.response_url) {
              await respondEphemeral(payload.response_url, res.message);
            } else {
              await sendDM(env, userId, res.message);
            }
            break;
          }
          default:
            await log(env, 'warning', 'interactive: unknown action', { actionId });
        }
      }
    } else {
      await log(env, 'info', 'interactive: unsupported type', { type });
    }
    // Modal submissions
    if (type === 'view_submission' && userId) {
      const callbackId = payload.view?.callback_id as string | undefined;
      if (callbackId === DIBS_ON_CALLBACK_ID) {
        try {
          const metaRaw = payload.view?.private_metadata as string | undefined;
          const meta = metaRaw ? JSON.parse(metaRaw) : {};
          const envName = String(meta.envName || '').trim();
          const values = payload.view?.state?.values as any;
          const dur = values?.[DURATION_BLOCK_ID]?.[DURATION_ACTION_ID]?.value as string | undefined;
          const note = values?.[NOTE_BLOCK_ID]?.[NOTE_ACTION_ID]?.value as string | undefined;
          const seconds = parseDurationToSeconds(dur);
          const res = await dibOn(env, userId, envName, {
            requestedSeconds: seconds ?? undefined,
            note: note?.trim() || undefined,
          });
          await sendDM(env, userId, res.message);
          await publishHomeThrottled(env, userId);
        } catch (err: any) {
          await log(env, 'error', 'interactive: dibs_on_submit failed', { error: String(err?.message || err) });
        }
      } else if (callbackId === ADMIN_SETTINGS_CALLBACK_ID) {
        try {
          const values = payload.view?.state?.values as any;
          // Global toggles
          const dmSel = values?.[GL_DM_BLOCK]?.[GL_DM_ACTION]?.selected_option?.value as string | undefined;
          const remSel = values?.[GL_REM_BLOCK]?.[GL_REM_ACTION]?.selected_option?.value as string | undefined;
          const expSel = values?.[GL_EXP_BLOCK]?.[GL_EXP_ACTION]?.selected_option?.value as string | undefined;
          const annSel = values?.[GL_ANN_BLOCK]?.[GL_ANN_ACTION]?.selected_option?.value as string | undefined;
          const leadTxt = values?.[GL_LEAD_BLOCK]?.[GL_LEAD_ACTION]?.value as string | undefined;
          const minTxt = values?.[GL_MIN_BLOCK]?.[GL_MIN_ACTION]?.value as string | undefined;
          const logSel = values?.[GL_LOG_BLOCK]?.[GL_LOG_ACTION]?.selected_option?.value as string | undefined;
          const defExtTxt = values?.[GL_EXT_BLOCK]?.[GL_EXT_ACTION]?.value as string | undefined;

          if (dmSel === 'on' || dmSel === 'off') { await setDmEnabled(env, dmSel === 'on'); }
          if (remSel === 'on' || remSel === 'off') { await setDmReminderEnabled(env, remSel === 'on'); }
          if (expSel === 'on' || expSel === 'off') { await setDmExpiryEnabled(env, expSel === 'on'); }
          if (annSel === 'on' || annSel === 'off') { await setAnnounceGlobalEnabled(env, annSel === 'on'); }
          const leadSec = parseDurationToSeconds((leadTxt || '').trim());
          if (typeof leadSec === 'number' && leadSec > 0) { await setReminderLeadSeconds(env, leadSec); }
          const minSec = parseDurationToSeconds((minTxt || '').trim());
          if (typeof minSec === 'number' && minSec > 0) { await setReminderMinTTLSeconds(env, minSec); }
          if (logSel) {
            const lvl = normalizeLevel(logSel);
            if (lvl) { await setLogLevel(env, lvl); }
          }
          if (defExtTxt && defExtTxt.trim()) {
            const sec = parseDurationToSeconds(defExtTxt.trim());
            if (typeof sec === 'number' && sec > 0) { await setDefaultExtendSeconds(env, sec); }
          }

          // Per-env
          const envName = values?.[ENV_SELECT_BLOCK]?.[ENV_SELECT_ACTION]?.selected_option?.value as string | undefined;
          if (envName) {
            const defTxt = values?.[ENV_DEF_BLOCK]?.[ENV_DEF_ACTION]?.value as string | undefined;
            const maxTxt = values?.[ENV_MAX_BLOCK]?.[ENV_MAX_ACTION]?.value as string | undefined;
            const renTxt = values?.[ENV_REN_BLOCK]?.[ENV_REN_ACTION]?.value as string | undefined;
            const envAnnSel = values?.[ENV_ANN_BLOCK]?.[ENV_ANN_ACTION]?.selected_option?.value as string | undefined;
            const chId = values?.[ENV_CH_BLOCK]?.[ENV_CH_ACTION]?.selected_channel as string | undefined;

            if (defTxt && parseDurationToSeconds(defTxt)) {
              const sec = parseDurationToSeconds(defTxt) as number;
              await setDefaultTTL(env, envName, sec);
            }
            if (typeof maxTxt === 'string' && maxTxt.trim()) {
              if (maxTxt.trim().toLowerCase() === 'none') {
                await setMaxTTL(env, envName, null);
              } else {
                const sec = parseDurationToSeconds(maxTxt);
                if (typeof sec === 'number' && sec > 0) {
                  await setMaxTTL(env, envName, sec);
                }
              }
            }
            if (renTxt && renTxt.trim()) {
              await renameEnvironment(env, envName, renTxt.trim());
            }
            if (envAnnSel === 'on' || envAnnSel === 'off') {
              await setEnvAnnounceEnabled(env, envName, envAnnSel === 'on');
            }
            if (chId) {
              await setEnvChannelId(env, envName, chId);
            }
          }
          await sendDM(env, userId, 'Applied admin settings.');
        } catch (err: any) {
          await log(env, 'error', 'interactive: admin_settings_submit failed', { error: String(err?.message || err) });
        }
      }
    }
  } catch (err: any) {
    await log(env, 'error', 'interactive: handler failed', { error: String(err?.message || err) });
  }
}
