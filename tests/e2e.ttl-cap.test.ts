import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost } from './helpers';

describe('TTL cap enforcement', () => {
  beforeEach(async () => {
    await httpPost('/test/reset');
    await httpPost('/test/seed', { envs: [{ name: 'qa-ttl', defaultSeconds: 1800 }] }); // 30m default
  });

  it('on respects per-env max TTL and extend cannot exceed cap', async () => {
    // Set per-env max to 15m
    let r = await httpPost('/test/command', { text: 'set-max qa-ttl 15m', user_id: 'U_ADMIN' });
    expect(r.status).toBe(200);

    // Acquire should be capped at 15m (not 30m default)
    r = await httpPost('/test/command', { text: 'on qa-ttl', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('15m');

    // Try to extend by 30m; should hit cap and not extend
    r = await httpPost('/test/command', { text: 'extend qa-ttl for 30m', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(String(r.json.text)).toContain('Max TTL');
  });
});
