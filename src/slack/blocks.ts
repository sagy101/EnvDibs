// Slack Block Kit helpers (small, focused)

export function button(action_id: string, text: string, value: string, style?: 'primary' | 'danger'): any {
  const btn: any = {
    type: 'button',
    action_id,
    text: {
      type: 'plain_text',
      text,
      emoji: true,
    },
    value,
  };
  if (style) {
    btn.style = style;
  }
  return btn;
}

export function section(text: string): any {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

export function actions(elements: any[]): any {
  return {
    type: 'actions',
    elements,
  };
}

export function divider(): any {
  return { type: 'divider' };
}
