import { describe, it, expect, beforeEach } from 'vitest';
import { httpPost } from './helpers';

async function resetAndSeed() {
  await httpPost('/test/reset');
  await httpPost('/test/seed', {
    envs: [
      { name: 'qa-1', defaultSeconds: 1800 },
      { name: 'qa-2', defaultSeconds: 1800 },
      { name: 'qa-ttl', defaultSeconds: 1800 },
    ],
  });
}

async function setAcks(state: 'on' | 'off') {
  // Admin toggle
  await httpPost('/test/command', { text: `settings acks ${state}`, user_id: 'U_ADMIN' });
}

describe('Slash acks visibility + error surfacing', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it('acks OFF: hides successful on/off but shows extend and all errors', async () => {
    await setAcks('off');

    // Successes are hidden
    let r = await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(r.json.raw ?? '').toBe('');

    // Extend should always respond
    r = await httpPost('/test/command', { text: 'extend qa-1 for 15m', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(String(r.json.text || '')).toMatch(/Extended/i);

    r = await httpPost('/test/command', { text: 'off qa-1', user_id: 'U_A' });
    expect(r.status).toBe(200);
    expect(r.json.raw ?? '').toBe('');

    // Errors still show
    r = await httpPost('/test/command', { text: 'off qa-2', user_id: 'U_B' });
    expect(r.status).toBe(200);
    expect(String(r.json.text || '')).toMatch(/already free|You do not hold/i);

    r = await httpPost('/test/command', { text: 'on does-not-exist', user_id: 'U_A' });
    expect(String(r.json.text || '')).toMatch(/Environment not found/i);

    // Already hold error
    await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_C' });
    r = await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_C' });
    expect(String(r.json.text || '')).toMatch(/already hold/i);

    // Already queued error
    await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_D' }); // join queue behind U_C
    r = await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_D' });
    expect(String(r.json.text || '')).toMatch(/already in the queue/i);
  });

  it('acks OFF: over-max requested and extend-to-cap errors are visible', async () => {
    await setAcks('off');

    // Set per-env max to 15m
    let r = await httpPost('/test/command', { text: 'set-max qa-ttl 15m', user_id: 'U_ADMIN' });
    expect(r.status).toBe(200);

    // Over-max on request (error)
    r = await httpPost('/test/command', { text: 'on qa-ttl for 60m', user_id: 'U_A' });
    expect(String(r.json.text || '')).toMatch(/exceeds max TTL/i);

    // Acquire at default (capped silently), then extend to cap (error)
    await httpPost('/test/command', { text: 'on qa-ttl', user_id: 'U_A' });
    r = await httpPost('/test/command', { text: 'extend qa-ttl for 30m', user_id: 'U_A' });
    expect(String(r.json.text || '')).toMatch(/Max TTL reached/i);
  });

  it('acks ON: shows success messages', async () => {
    await setAcks('on');
    let r = await httpPost('/test/command', { text: 'on qa-2', user_id: 'U_X' });
    expect(String(r.json.text || '')).toMatch(/You now hold/i);

    r = await httpPost('/test/command', { text: 'off qa-2', user_id: 'U_X' });
    expect(String(r.json.text || '')).toMatch(/Released|already free/i);
  });

  it('acks OFF: queued join is visible (not considered full success)', async () => {
    await setAcks('off');
    // Make env busy
    await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_HOLDER' });
    // Join queue
    const r = await httpPost('/test/command', { text: 'on qa-1', user_id: 'U_JOIN' });
    expect(r.status).toBe(200);
    expect(String(r.json.text || '')).toMatch(/queued at position/i);
  });

  it('acks OFF: dequeue self via off is visible', async () => {
    await setAcks('off');
    // Make env busy and queue another user
    await httpPost('/test/command', { text: 'on qa-2', user_id: 'U_HOLDER' });
    await httpPost('/test/command', { text: 'on qa-2', user_id: 'U_Q' });
    // Dequeue self
    const r = await httpPost('/test/command', { text: 'off qa-2', user_id: 'U_Q' });
    expect(r.status).toBe(200);
    expect(String(r.json.text || '')).toMatch(/Removed you from the queue/i);
  });
});
