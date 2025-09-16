import { getLogLevel } from '../../services/log';
import type { Env } from '../../types';
import { humanizeSeconds } from '../format';

export const ADMIN_SETTINGS_CALLBACK_ID = 'admin_settings_submit';

export const GL_DM_BLOCK = 'gl_dm_block';
export const GL_DM_ACTION = 'gl_dm_action';
export const GL_REM_BLOCK = 'gl_rem_block';
export const GL_REM_ACTION = 'gl_rem_action';
export const GL_EXP_BLOCK = 'gl_exp_block';
export const GL_EXP_ACTION = 'gl_exp_action';
export const GL_ANN_BLOCK = 'gl_ann_block';
export const GL_ANN_ACTION = 'gl_ann_action';
export const GL_LEAD_BLOCK = 'gl_lead_block';
export const GL_LEAD_ACTION = 'gl_lead_action';
export const GL_MIN_BLOCK = 'gl_min_block';
export const GL_MIN_ACTION = 'gl_min_action';
export const GL_LOG_BLOCK = 'gl_log_block';
export const GL_LOG_ACTION = 'gl_log_action';
export const GL_EXT_BLOCK = 'gl_ext_block';
export const GL_EXT_ACTION = 'gl_ext_action';
export const GL_ACKS_BLOCK = 'gl_acks_block';
export const GL_ACKS_ACTION = 'gl_acks_action';

export const ENV_SELECT_BLOCK = 'env_sel_block';
export const ENV_SELECT_ACTION = 'env_sel_action';
export const ENV_DEF_BLOCK = 'env_def_block';
export const ENV_DEF_ACTION = 'env_def_action';
export const ENV_MAX_BLOCK = 'env_max_block';
export const ENV_MAX_ACTION = 'env_max_action';
export const ENV_REN_BLOCK = 'env_ren_block';
export const ENV_REN_ACTION = 'env_ren_action';
export const ENV_ANN_BLOCK = 'env_ann_block';
export const ENV_ANN_ACTION = 'env_ann_action';
export const ENV_CH_BLOCK = 'env_ch_block';
export const ENV_CH_ACTION = 'env_ch_action';

export async function buildAdminSettingsModal(env: Env, selectedEnvName?: string, opts?: { dmOverride?: boolean }): Promise<any> {
  // Load current global settings
  const [dm, rem, exp, lead, min, level, ann, defExt, acks] = await Promise.all([
    (await import('../../services/settings')).getDmEnabled(env),
    (await import('../../services/settings')).getDmReminderEnabled(env),
    (await import('../../services/settings')).getDmExpiryEnabled(env),
    (await import('../../services/settings')).getReminderLeadSeconds(env),
    (await import('../../services/settings')).getReminderMinTTLSeconds(env),
    getLogLevel(env),
    (await import('../../services/settings')).getAnnounceGlobalEnabled(env),
    (await import('../../services/settings')).getDefaultExtendSeconds(env),
    (await import('../../services/settings')).getCommandAcksEnabled(env),
  ]);

  const dmOn = typeof opts?.dmOverride === 'boolean' ? opts.dmOverride : dm;

  // Load envs for per-env operations
  const envs = await env.DB
    .prepare('SELECT id, name, default_ttl_seconds, max_ttl_seconds, announce_enabled, channel_id FROM envs WHERE is_archived = 0 ORDER BY name ASC LIMIT 100')
    .all<{ id: string; name: string; default_ttl_seconds: number; max_ttl_seconds: number | null; announce_enabled: number | null; channel_id: string | null }>();

  const envRow = selectedEnvName
    ? envs.results.find((e) => e.name.toLowerCase() === selectedEnvName.toLowerCase())
    : undefined;

  const onOff = (selected: boolean) => ({
    type: 'static_select',
    action_id: GL_DM_ACTION,
    options: [
      { text: { type: 'plain_text', text: 'on' }, value: 'on' },
      { text: { type: 'plain_text', text: 'off' }, value: 'off' },
    ],
    initial_option: { text: { type: 'plain_text', text: selected ? 'on' : 'off' }, value: selected ? 'on' : 'off' },
  });

  return {
    type: 'modal',
    callback_id: ADMIN_SETTINGS_CALLBACK_ID,
    title: { type: 'plain_text', text: 'Admin Settings' },
    submit: { type: 'plain_text', text: 'Apply' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Global settings*' } },
      {
        type: 'input', block_id: GL_DM_BLOCK, label: { type: 'plain_text', text: 'DMs' }, optional: true, dispatch_action: true,
        element: { ...onOff(dmOn), action_id: GL_DM_ACTION },
      },
      ...(dmOn ? [
        {
          type: 'input', block_id: GL_REM_BLOCK, label: { type: 'plain_text', text: 'Reminder DMs' }, optional: true,
          element: { ...onOff(rem), action_id: GL_REM_ACTION },
        },
        {
          type: 'input', block_id: GL_EXP_BLOCK, label: { type: 'plain_text', text: 'Expiry DMs' }, optional: true,
          element: { ...onOff(exp), action_id: GL_EXP_ACTION },
        },
      ] : []),
      {
        type: 'input', block_id: GL_ANN_BLOCK, label: { type: 'plain_text', text: 'Announcements (global)' }, optional: true,
        element: { ...onOff(ann), action_id: GL_ANN_ACTION },
      },
      {
        type: 'input', block_id: GL_LEAD_BLOCK, label: { type: 'plain_text', text: 'Reminder lead' }, optional: true,
        element: { type: 'plain_text_input', action_id: GL_LEAD_ACTION, placeholder: { type: 'plain_text', text: 'e.g., 15m, 30m' }, initial_value: humanizeSeconds(lead) },
      },
      {
        type: 'input', block_id: GL_MIN_BLOCK, label: { type: 'plain_text', text: 'Reminder min TTL' }, optional: true,
        element: { type: 'plain_text_input', action_id: GL_MIN_ACTION, placeholder: { type: 'plain_text', text: 'e.g., 10m' }, initial_value: humanizeSeconds(min) },
      },
      {
        type: 'input', block_id: GL_LOG_BLOCK, label: { type: 'plain_text', text: 'Log level' }, optional: true,
        element: {
          type: 'static_select', action_id: GL_LOG_ACTION,
          options: [
            { text: { type: 'plain_text', text: 'info' }, value: 'info' },
            { text: { type: 'plain_text', text: 'warning' }, value: 'warning' },
            { text: { type: 'plain_text', text: 'error' }, value: 'error' },
          ],
          initial_option: { text: { type: 'plain_text', text: level }, value: level },
        },
      },
      {
        type: 'input', block_id: GL_ACKS_BLOCK, label: { type: 'plain_text', text: 'Slash responses (on/off)' }, optional: true,
        element: { ...onOff(acks), action_id: GL_ACKS_ACTION },
      },
      {
        type: 'input', block_id: GL_EXT_BLOCK, label: { type: 'plain_text', text: 'Default extend' }, optional: true,
        element: {
          type: 'plain_text_input', action_id: GL_EXT_ACTION, placeholder: { type: 'plain_text', text: 'e.g., 15m, 30m' },
          initial_value: humanizeSeconds(defExt),
        },
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*Per-environment settings*' } },
      {
        type: 'input', block_id: ENV_SELECT_BLOCK, label: { type: 'plain_text', text: 'Environment' }, optional: true, dispatch_action: true,
        element: {
          type: 'static_select', action_id: ENV_SELECT_ACTION,
          options: envs.results.map((e) => ({ text: { type: 'plain_text', text: e.name }, value: e.name })),
          ...(envRow ? { initial_option: { text: { type: 'plain_text', text: envRow.name }, value: envRow.name } } : {}),
        },
      },
      {
        type: 'input', block_id: ENV_DEF_BLOCK, label: { type: 'plain_text', text: 'Default TTL' }, optional: true,
        element: {
          type: 'plain_text_input', action_id: ENV_DEF_ACTION, placeholder: { type: 'plain_text', text: 'e.g., 90m, 2h' },
          ...(envRow ? { initial_value: humanizeSeconds(envRow.default_ttl_seconds) } : {}),
        },
      },
      {
        type: 'input', block_id: ENV_MAX_BLOCK, label: { type: 'plain_text', text: 'Max TTL' }, optional: true,
        element: {
          type: 'plain_text_input', action_id: ENV_MAX_ACTION, placeholder: { type: 'plain_text', text: 'e.g., 2h, or none' },
          ...(envRow ? { initial_value: (typeof envRow.max_ttl_seconds === 'number' ? humanizeSeconds(envRow.max_ttl_seconds) : '') } : {}),
        },
      },
      {
        type: 'input', block_id: ENV_REN_BLOCK, label: { type: 'plain_text', text: 'Rename to' }, optional: true,
        element: { type: 'plain_text_input', action_id: ENV_REN_ACTION, placeholder: { type: 'plain_text', text: 'new-name' } },
      },
      {
        type: 'input', block_id: ENV_ANN_BLOCK, label: { type: 'plain_text', text: 'Announcements (per-env)' }, optional: true,
        element: {
          type: 'static_select', action_id: ENV_ANN_ACTION,
          options: [
            { text: { type: 'plain_text', text: 'on' }, value: 'on' },
            { text: { type: 'plain_text', text: 'off' }, value: 'off' },
          ],
          ...(envRow ? { initial_option: { text: { type: 'plain_text', text: (envRow.announce_enabled ? 'on' : 'off') }, value: (envRow.announce_enabled ? 'on' : 'off') } } : {}),
        },
      },
      {
        type: 'input', block_id: ENV_CH_BLOCK, label: { type: 'plain_text', text: 'Announcement channel' }, optional: true,
        element: {
          type: 'channels_select', action_id: ENV_CH_ACTION,
          ...(envRow && envRow.channel_id ? { initial_channel: envRow.channel_id } : {}),
        },
      },
    ],
  };
}
