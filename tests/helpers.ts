import { SELF, env } from 'cloudflare:test';

export async function httpPost(path: string, body?: any) {
  const req = new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as any;
  const res = await (SELF as any).fetch(req, env as any, ctx);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, text };
}

export async function httpGet(path: string) {
  const req = new Request(`http://test${path}`, { method: 'GET' });
  const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as any;
  const res = await (SELF as any).fetch(req, env as any, ctx);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, text };
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitForSlackMessages(min: number, timeoutMs = 1000): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const peek = await httpGet('/test/slack/peek');
    const messages = peek.json?.messages || [];
    if (messages.length >= min) return messages;
    await sleep(50);
  }
  const peek = await httpGet('/test/slack/peek');
  return peek.json?.messages || [];
}

export async function waitForSlackViews(min: number, timeoutMs = 1000): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const peek = await httpGet('/test/slack/peek');
    const views = peek.json?.views || [];
    if (views.length >= min) return views;
    await sleep(50);
  }
  const peek = await httpGet('/test/slack/peek');
  return peek.json?.views || [];
}
