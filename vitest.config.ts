import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
        bindings: {
          SLACK_SIGNING_SECRET: 'test-signing',
          SLACK_BOT_TOKEN: 'xoxb-test',
          ALLOW_TEST: 'true',
          ADMIN_USERS: 'U_ADMIN',
          SLACK_API_BASE: 'http://test/__slack',
        },
      },
    },
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
