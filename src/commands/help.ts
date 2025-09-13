export function buildHelp(isAdminUser: boolean): string {
  const lines: string[] = [
    '*EnvDibs* — Dibs, not drama—for dev environments',
    '',
    '────────',
    '*📌 Basics*',
    '• /dib on <env> [for <duration>] [note <text>] — acquire a hold or join the queue',
    '• /dib off <env> — release your hold or leave the queue',
    '• /dib list [all|active|mine|free] — view environments and status',
    '',
    '────────',
    '*⏱️ Info & Time*',
    '• /dib info <env> — details: holder, remaining, queue, TTLs',
    '• /dib extend <env> [for <duration>] — extend your active hold (uses global default if omitted)',
    '',
  ];

  if (isAdminUser) {
    lines.push(
      '────────',
      '*🛠️ Manage Environments (admin)*',
      '• /dib add <env> [default <duration>] [desc <text>]',
      '• /dib set-default <env> <duration>',
      '• /dib set-max <env> <duration|none>',
      '• /dib archive <env> | /dib unarchive <env>',
      '• /dib rename <env> <new-name>',
      '',
      '────────',
      '*👑 Admins (admin)*',
      '• /dib admin <add|remove|list> [<@user|U123>]',
      '',
      '────────',
      '*🔔 DMs & Reminders (admin)*',
      '• /dib force-off <env> — force release and reassign',
      '• /dib transfer <env> to <@user|U123> — transfer current hold',
      '• /dib announce <on|off> — toggle global announcements',
      '• /dib announce <env> <on|off> — per-environment announcements',
      '• /dib announce channel <env> <#channel|C123> — set announce channel',
      '• /dib settings — show current settings',
      '• /dib settings modal — open admin settings modal',
      '• /dib dms <on|off> — global DMs; also: dms reminder <on|off>, dms expiry <on|off>',
      '• /dib reminders <lead|min> <duration> — reminder timing',
      '• /dib extend-default <duration> — set global default extend duration',
      '• /dib log <info|warning|error> — set log verbosity'
    );
  }

  lines.push(
    '',
    '────────',
    '*🧪 Examples*',
    '• /dib on qa-1 for 90m note smoke tests',
    '• /dib extend qa-1 for 15m',
    '• /dib set-max qa-1 2h',
    '',
    '────────',
    '*📝 Notes*',
    '• Duration format: 10m, 2h, 1d'
  );

  return lines.join('\n');
}
