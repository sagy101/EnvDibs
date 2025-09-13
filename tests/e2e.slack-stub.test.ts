import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost, httpGet } from './helpers';

// Verifies the in-Worker Slack HTTP stub under /__slack/* records events
// and that /test/slack/peek exposes them.
describe('Slack stub recording', () => {
  beforeEach(async () => {
    await httpPost('/test/slack/reset');
  });

  it('records chat.postMessage and views.publish', async () => {
    // Send a message to the stub directly
    let r = await httpPost('/__slack/chat.postMessage', { channel: 'C_TEST', text: 'Hello from test' });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);

    // Publish a view
    r = await httpPost('/__slack/views.publish', { user_id: 'U_TEST', view: { type: 'home', blocks: [] } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);

    // Peek and ensure both are present
    const peek = await httpGet('/test/slack/peek');
    expect(peek.status).toBe(200);
    const messages = peek.json?.messages || [];
    const views = peek.json?.views || [];
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(views.length).toBeGreaterThanOrEqual(1);
  });
});
