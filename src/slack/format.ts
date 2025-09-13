export function slackDate(epochSeconds: number): string {
  const fallback = new Date(epochSeconds * 1000).toISOString();
  return `<!date^${epochSeconds}^{date_short_pretty} {time}|${fallback}>`;
}

export function humanizeSeconds(total: number): string {
  if (total <= 0) {return '0s';}
  const d = Math.floor(total / 86400);
  total %= 86400;
  const h = Math.floor(total / 3600);
  total %= 3600;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d) {parts.push(`${d}d`);}
  if (h) {parts.push(`${h}h`);}
  if (m) {parts.push(`${m}m`);}
  if (!d && !h && !m && s) {parts.push(`${s}s`);}
  return parts.join(' ');
}
