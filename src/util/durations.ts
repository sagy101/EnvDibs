// Duration parsing helpers
// Accepts inputs like: "90m", "2h", "1d 3h", "2hours", "45min", "PT2H"

export function parseDurationToSeconds(input: string | undefined | null): number | null {
  if (!input) {return null;}
  const s = input.trim().toLowerCase();
  if (!s) {return null;}

  // Simple ISO-like pattern: PT2H, PT30M, PT1H30M (case-insensitive)
  const isoRe = /^p?t?(\d+h)?(\d+m)?(\d+s)?$/i;
  const iso = isoRe.exec(s);
  if (iso) {
    return (
      partToNumber(iso[1]) * 3600 +
      partToNumber(iso[2]) * 60 +
      partToNumber(iso[3])
    );
  }

  // General patterns: numbers + units
  const regex = /(\d+)\s*(d|day|days|h|hr|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = regex.exec(s)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    if (Number.isNaN(value)) {continue;}
    if (unit.startsWith('d')) {total += value * 86400;}
    else if (unit.startsWith('h')) {total += value * 3600;}
    else if (unit.startsWith('m')) {total += value * 60;}
    else if (unit.startsWith('s')) {total += value;}
  }
  if (total > 0) {return total;}

  // Fallback: plain number treated as minutes
  const asNum = Number(s);
  if (!Number.isNaN(asNum) && asNum > 0) {return asNum * 60;}

  return null;
}

function partToNumber(part?: string | null): number {
  if (!part) {return 0;}
  const n = Number(part.replace(/\D/g, ''));
  return Number.isNaN(n) ? 0 : n;
}
