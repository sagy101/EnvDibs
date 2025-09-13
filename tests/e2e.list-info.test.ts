import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost } from './helpers';

describe('List & Info', () => {
  beforeEach(async () => {
    await httpPost('/test/reset');
    await httpPost('/test/seed', { envs: [{ name: 'qa-l1', defaultSeconds: 1800 }, { name: 'qa-l2', defaultSeconds: 1200 }] });
  });

  it('list all, list active, list mine, and info show correct details', async () => {
    // Acquire qa-l1 by U_A
    await httpPost('/test/command', { text: 'on qa-l1', user_id: 'U_A' });
    // U_B queues on qa-l1
    await httpPost('/test/command', { text: 'on qa-l1', user_id: 'U_B' });

    // list all
    let r = await httpPost('/test/command', { text: 'list all', user_id: 'U_X' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('`qa-l1` — *held by* <@U_A>');

    // list active
    r = await httpPost('/test/command', { text: 'list active', user_id: 'U_X' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('Environments (active)');

    // list mine (U_B)
    r = await httpPost('/test/command', { text: 'list mine', user_id: 'U_B' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('Environments (yours)');

    // info
    r = await httpPost('/test/command', { text: 'info qa-l1', user_id: 'U_X' });
    expect(r.status).toBe(200);
    const txt = String(r.json.text || r.json.message || '');
    expect(txt).toContain('Environment');
    expect(txt).toContain('Default TTL');
    expect(txt).toContain('Queue:');
  });

  it('list free shows only free environments', async () => {
    // Acquire qa-l1 by U_A; qa-l2 remains free
    await httpPost('/test/command', { text: 'on qa-l1', user_id: 'U_A' });

    const r = await httpPost('/test/command', { text: 'list free', user_id: 'U_X' });
    expect(r.status).toBe(200);
    const txt = String(r.json.text || '');
    expect(txt).toContain('Environments (free)');
    expect(txt).toContain('`qa-l2` — *free*');
    expect(txt).not.toContain('held by');
  });
});
