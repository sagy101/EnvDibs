import { humanizeSeconds } from '../format';

export const DIBS_ON_CALLBACK_ID = 'dibs_on_submit';
export const DURATION_BLOCK_ID = 'duration_block';
export const DURATION_ACTION_ID = 'duration_input';
export const NOTE_BLOCK_ID = 'note_block';
export const NOTE_ACTION_ID = 'note_input';

export function buildDibsOnModal(envName: string, defaultTtlSeconds?: number): any {
  const initial = typeof defaultTtlSeconds === 'number' && defaultTtlSeconds > 0
    ? humanizeSeconds(defaultTtlSeconds)
    : undefined;
  return {
    type: 'modal',
    callback_id: DIBS_ON_CALLBACK_ID,
    title: { type: 'plain_text', text: 'Dibs on' },
    submit: { type: 'plain_text', text: 'Hold' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ envName }),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Acquire \`${envName}\`. Set an optional duration and note.` },
      },
      {
        type: 'input',
        optional: true,
        block_id: DURATION_BLOCK_ID,
        label: { type: 'plain_text', text: 'Duration' },
        element: {
          type: 'plain_text_input',
          action_id: DURATION_ACTION_ID,
          placeholder: { type: 'plain_text', text: 'e.g., 90m, 2h' },
          ...(initial ? { initial_value: initial } : {}),
        },
      },
      {
        type: 'input',
        optional: true,
        block_id: NOTE_BLOCK_ID,
        label: { type: 'plain_text', text: 'Note' },
        element: {
          type: 'plain_text_input',
          action_id: NOTE_ACTION_ID,
          placeholder: { type: 'plain_text', text: 'optional context (e.g., smoke test)' },
        },
      },
    ],
  };
}
