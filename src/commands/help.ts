export function buildHelp(isAdminUser: boolean): string {
  const lines: string[] = [
    '*EnvDibs* — Dibs, not drama—for dev environments',
    '',
    '────────',
    'Use `/claim` (alias `/dib`).',
    '',
    '*📌 Basics*',
    '• /claim on <env> [for <duration>] [note <text>] — acquire a hold or join the queue',
    '• /claim off <env> — release your hold or leave the queue',
    '• /claim list [all|active|mine|free] — view environments and status',
    '',
    '────────',
    '*⏱️ Info & Time*',
    '• /claim info <env> — details: holder, remaining, queue, TTLs',
    '• /claim extend <env> [for <duration>] — extend your active hold (uses global default if omitted)',
    '',
  ];

  if (isAdminUser) {
    lines.push(
      '────────',
      '*🛠️ Manage Environments (admin)*',
      '• /claim add <env> [default <duration>] [desc <text>]',
      '• /claim set-default <env> <duration>',
      '• /claim set-max <env> <duration|none>',
      '• /claim archive <env> | /claim unarchive <env>',
      '• /claim rename <env> <new-name>',
      '',
      '────────',
      '*👑 Admins (admin)*',
      '• /claim admin <add|remove|list> [<@user|U123>]',
      '',
      '────────',
      '*🔔 DMs & Reminders (admin)*',
      '• /claim force-off <env> — force release and reassign',
      '• /claim transfer <env> to <@user|U123> — transfer current hold',
      '• /claim announce <on|off> — toggle global announcements',
      '• /claim announce <env> <on|off> — per-environment announcements',
      '• /claim announce channel <env> <#channel|C123> — set announce channel',
      '• /claim settings — show current settings',
      '• /claim settings modal — open admin settings modal',
      '• /claim settings acks <on|off> — show or suppress responses for on/off',
      '• /claim dms <on|off> — global DMs; also: dms reminder <on|off>, dms expiry <on|off>',
      '• /claim reminders <lead|min> <duration> — reminder timing',
      '• /claim extend-default <duration> — set global default extend duration',
      '• /claim log <info|warning|error> — set log verbosity'
    );
  }

  lines.push(
    '',
    '────────',
    '*🧪 Examples*',
    '• /claim on qa-1 for 90m note smoke tests',
    '• /claim extend qa-1 for 15m',
    '• /claim set-max qa-1 2h',
    '',
    '────────',
    '*📝 Notes*',
    '• Duration format: 10m, 2h, 1d'
  );

  return lines.join('\n');
}
