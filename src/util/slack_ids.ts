export function parseChannelId(input: string | undefined): string | null {
  if (!input) {
    return null;
  }
  const s = input.trim();
  // Accept <#C123|name>, <#C123>, or raw ID C123 / G123
  const mention = /^<#([A-Z0-9]+)(?:\|[^>]+)?>$/i.exec(s);
  if (mention) {
    return mention[1];
  }
  const bareId = /^#?([A-Z0-9]+)$/i.exec(s);
  return bareId?.[1] ?? null;
}
