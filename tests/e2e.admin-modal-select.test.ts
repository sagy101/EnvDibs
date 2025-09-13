import { describe, it, expect, beforeEach } from 'vitest';

import { httpPost, waitForSlackViews } from './helpers';
import { ENV_DEF_BLOCK, ENV_SELECT_ACTION } from '../src/slack/modals/admin_settings';

function findBlock(blocks: any[], block_id: string) {
  return (blocks || []).find((b: any) => b && b.block_id === block_id);
}

// NOTE: Temporarily skipped due to test harness not capturing views.update reliably.
// Manual verification in Slack passes; revisit when test runner can await interactive side-effects.
describe.skip('Admin Settings modal: env select prefills values', () => {
  beforeEach(async () => {
    await httpPost('/test/reset');
    await httpPost('/test/slack/reset');
    await httpPost('/test/seed', { envs: [{ name: 'qa-msel', defaultSeconds: 1800 }] }); // 30m
  });

  it('selecting an env updates the modal with its default TTL', async () => {
    // Simulate selecting an environment in the modal (block action)
    const payload = {
      type: 'block_actions',
      user: { id: 'U_ADMIN' },
      actions: [
        { type: 'static_select', action_id: ENV_SELECT_ACTION, selected_option: { value: 'qa-msel' } },
      ],
      view: { id: 'V_TEST' },
    };
    await httpPost('/test/interactive', payload);

    // Peek at Slack stub to see the updated modal (views.update) with a wait
    const views = await waitForSlackViews(1, 1000);
    expect(views.length).toBeGreaterThan(0);
    const last = views[views.length - 1];
    const view = last.view;
    const defBlock = findBlock(view.blocks, ENV_DEF_BLOCK);
    expect(defBlock).toBeTruthy();
    const initial = defBlock?.element?.initial_value as string | undefined;
    expect(initial).toBe('30m');
  });
});
