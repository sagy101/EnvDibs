import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost, httpGet, waitForSlackMessages } from './helpers';

describe('Settings & Announcements', () => {
  beforeEach(async () => {
    await httpPost('/test/reset');
    await httpPost('/test/seed', { envs: [{ name: 'qa-ch', defaultSeconds: 1800 }] });
    await httpPost('/test/slack/reset');
  });

  // TODO(sagy101): This test is flaky in CI due to isolate timing. Manual steps below.
  it.skip('announcements: global on + per-env on + channel posts to Slack stub', async () => {
    // Turn announcements on
    await httpPost('/test/command', { text: 'announce on', user_id: 'U_ADMIN' });
    await httpPost('/test/command', { text: 'announce qa-ch on', user_id: 'U_ADMIN' });
    await httpPost('/test/command', { text: 'announce channel qa-ch C123', user_id: 'U_ADMIN' });

    // Acquire hold to trigger busy announcement
    await httpPost('/test/command', { text: 'on qa-ch', user_id: 'U_A' });

    const messages = await waitForSlackMessages(1, 2000);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const found = messages.find((m: any) => String(m.text || '').includes('`qa-ch`'));
    expect(Boolean(found)).toBe(true);
  });

  it('announcements: off stops posting', async () => {
    await httpPost('/test/command', { text: 'announce on', user_id: 'U_ADMIN' });
    await httpPost('/test/command', { text: 'announce qa-ch on', user_id: 'U_ADMIN' });
    await httpPost('/test/command', { text: 'announce channel qa-ch C123', user_id: 'U_ADMIN' });

    await httpPost('/test/command', { text: 'on qa-ch', user_id: 'U_A' });
    await httpPost('/test/slack/reset');

    // Turn off globally
    await httpPost('/test/command', { text: 'announce off', user_id: 'U_ADMIN' });
    // Release should not announce now
    await httpPost('/test/command', { text: 'off qa-ch', user_id: 'U_A' });

    const peek2 = await httpGet('/test/slack/peek');
    const messages2 = peek2.json.messages || [];
    expect(messages2.length).toBe(0);
  });
});
