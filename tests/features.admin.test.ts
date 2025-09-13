import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

async function post(path: string, body?: any) {
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

async function resetAndSeed() {
  await post('/test/reset');
  await post('/test/seed', { envs: [{ name: 'qa-admin', defaultSeconds: 3600 }] });
}

describe('Admin flows', () => {
  beforeAll(async () => {
    await resetAndSeed();
  });

  it('admin can set defaults and max, rename, archive/unarchive', async () => {
    let r = await post('/test/command', { text: 'set-default qa-admin 90m', user_id: 'U_ADMIN' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('Default TTL for `qa-admin` set to 90m');

    r = await post('/test/command', { text: 'set-max qa-admin 2h', user_id: 'U_ADMIN' });
    expect(String(r.json.text)).toContain('Max TTL for `qa-admin` set to 120m');

    r = await post('/test/command', { text: 'rename qa-admin qa-renamed', user_id: 'U_ADMIN' });
    expect(String(r.json.text)).toContain('Renamed environment `qa-admin` to `qa-renamed`');

    r = await post('/test/command', { text: 'archive qa-renamed', user_id: 'U_ADMIN' });
    expect(String(r.json.text)).toContain('Archived environment `qa-renamed`');

    r = await post('/test/command', { text: 'unarchive qa-renamed', user_id: 'U_ADMIN' });
    expect(String(r.json.text)).toContain('Unarchived environment `qa-renamed`');
  });

  it('force-off and transfer', async () => {
    await resetAndSeed();
    // A acquires
    await post('/test/command', { text: 'on qa-admin', user_id: 'U_A' });

    // force-off by admin
    let r = await post('/test/command', { text: 'force-off qa-admin', user_id: 'U_ADMIN' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toMatch(/is now free|Assigned to/);

    // A again acquires, then transfer to B
    await post('/test/command', { text: 'on qa-admin', user_id: 'U_A' });
    r = await post('/test/command', { text: 'transfer qa-admin to U123', user_id: 'U_ADMIN' });
    expect(String(r.json.text)).toContain('Transferred `qa-admin` to <@U123>');
  });
});
