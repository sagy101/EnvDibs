export function normalizeEnvName(input: string): string {
  const s = (input || '').trim().toLowerCase();
  if (!s) {throw new Error('Environment name is required');}
  // Replace spaces with '-'
  const replaced = s.replace(/\s+/g, '-');
  // Keep only allowed characters
  const normalized = replaced.replace(/[^a-z0-9_-]/g, '');
  if (!normalized) {throw new Error('Environment name must contain letters or numbers');}
  if (normalized.length > 40) {throw new Error('Environment name must be 40 characters or fewer');}
  return normalized;
}
