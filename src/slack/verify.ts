// Slack signature verification for Cloudflare Workers (TypeScript)

export type VerificationResult = {
  verified: boolean;
  reason: string;
  rawBody: string;
};

export async function verifySlackRequest(request: Request, signingSecret: string): Promise<VerificationResult> {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const signature = request.headers.get('X-Slack-Signature');

  if (!timestamp || !signature) {
    return { verified: false, reason: 'missing_headers', rawBody: '' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    return { verified: false, reason: 'timestamp_out_of_range', rawBody: '' };
  }

  const rawBody = await request.text();
  const baseString = `v0:${timestamp}:${rawBody}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  const expected = 'v0=' + toHex(sigBuffer);

  const verified = timingSafeEqual(expected, signature);
  return { verified, reason: verified ? 'ok' : 'mismatch', rawBody };
}

function timingSafeEqual(a: string | null, b: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {return false;}
  const aLen = a.length;
  const bLen = b.length;
  let mismatch = aLen === bLen ? 0 : 1;
  const len = Math.max(aLen, bLen);
  for (let i = 0; i < len; i++) {
    const ca = i < aLen ? a.charCodeAt(i) : 0;
    const cb = i < bLen ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
