import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost } from './helpers';

describe('Help context visibility', () => {
  beforeEach(async () => {
    await httpPost('/test/reset');
    await httpPost('/test/seed', { envs: [{ name: 'qa-help', defaultSeconds: 600 }] });
  });

  it('non-admin sees only basic commands', async () => {
    const r = await httpPost('/test/command', { text: '', user_id: 'U_X' });
    expect(r.status).toBe(200);
    const txt = String(r.json.text || '');
    expect(txt).toContain('Basics');
    expect(txt).toContain('/dib list');
    expect(txt).not.toContain('Manage Environments (admin)');
    expect(txt).not.toContain('/dib admin ');
    expect(txt).not.toContain('/dib force-off');
  });

  it('admin sees admin sections', async () => {
    const r = await httpPost('/test/command', { text: '', user_id: 'U_ADMIN' });
    expect(r.status).toBe(200);
    const txt = String(r.json.text || '');
    expect(txt).toContain('Manage Environments (admin)');
    expect(txt).toContain('/dib set-default');
    expect(txt).toContain('/dib admin ');
  });
});
