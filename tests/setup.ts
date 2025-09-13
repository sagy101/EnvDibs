import { env } from 'cloudflare:test';

// Ensure necessary bindings for tests
(env as any).ALLOW_TEST = 'true';
(env as any).ADMIN_USERS = (env as any).ADMIN_USERS || 'U_ADMIN';
(env as any).SLACK_BOT_TOKEN = (env as any).SLACK_BOT_TOKEN || 'xoxb-test';
(env as any).SLACK_API_BASE = (env as any).SLACK_API_BASE || 'http://test/__slack';

export {};
