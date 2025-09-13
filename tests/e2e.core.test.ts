import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

async function post(path: string, body?: any) {
  const req = new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Minimal ExecutionContext
  const ctx = { waitUntil: (_p: Promise<unknown>) => {} } as any;
  const res = await (SELF as any).fetch(req, env as any, ctx);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, text };
}

async function resetAndSeed() {
  await post('/test/reset');
  await post('/test/seed', {
    envs: [
      { name: 'qa-1', defaultSeconds: 1800 },
      { name: 'qa-2', defaultSeconds: 1200 },
    ],
  });
}

describe('EnvDibs E2E — core flows', () => {
  beforeAll(async () => {
    await resetAndSeed();
  });

  it('dib on acquires when free; extend; off releases', async () => {
    // U_A acquires qa-1
    let r = await post('/test/command', { text: 'on qa-1', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(r.json.response_type).toBe('ephemeral');
    expect(String(r.json.text)).toContain('You now hold `qa-1`');

    // extend 15m
    r = await post('/test/command', { text: 'extend qa-1 for 15m', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('Extended `qa-1`');

    // off
    r = await post('/test/command', { text: 'off qa-1', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toMatch(/Released `qa-1`|`qa-1` is already free/);
  });

  it('queue join shows ETA; leave queue removes; re-acquire', async () => {
    await resetAndSeed();
    // A holds qa-1
    await post('/test/command', { text: 'on qa-1', user_id: 'U_A' });

    // B tries and gets queued with ETA
    let r = await post('/test/command', { text: 'on qa-1', user_id: 'U_B' });
    expect(String(r.json.text)).toContain('queued at position 1');
    expect(String(r.json.text)).toContain('ETA ~');

    // B leaves queue
    r = await post('/test/command', { text: 'off qa-1', user_id: 'U_B' });
    expect(String(r.json.text)).toMatch(/Removed you from the queue|is already free/);

    // A off, then B on acquires
    await post('/test/command', { text: 'off qa-1', user_id: 'U_A' });
    r = await post('/test/command', { text: 'on qa-1', user_id: 'U_B' });
    expect(String(r.json.text)).toContain('You now hold `qa-1`');
  });

  it('list active shows holder', async () => {
    await resetAndSeed();
    await post('/test/command', { text: 'on qa-2', user_id: 'U_C' });
    const r = await post('/test/command', { text: 'list active', user_id: 'U_X' });
    expect(r.status).toBe(200);
    const text: string = r.json.text || '';
    expect(text).toContain('Environments (active)');
    expect(text).toContain('`qa-2` — *held by* <@U_C>');
  });
});
