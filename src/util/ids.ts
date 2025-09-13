export function uuid(): string {
  // Cloudflare Workers support crypto.randomUUID
  return crypto.randomUUID();
}
