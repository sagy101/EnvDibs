// Response helpers for Slack-compatible JSON payloads

export type SlackEphemeral = {
  response_type: 'ephemeral';
  text: string;
};

export type SlackInChannel = {
  response_type: 'in_channel';
  text: string;
};

export type SlackResponse = SlackEphemeral | SlackInChannel | Record<string, unknown>;

export function jsonResponse(obj: SlackResponse, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function ephemeral(text: string): SlackEphemeral {
  return { response_type: 'ephemeral', text };
}

export function inChannel(text: string): SlackInChannel {
  return { response_type: 'in_channel', text };
}

export function ok(): Response {
  return jsonResponse({ ok: true });
}
