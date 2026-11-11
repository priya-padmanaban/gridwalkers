import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const namespace = process.env.PLAYWRIGHT_GRID_NAMESPACE ??= 'e2e-' + randomUUID();
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 900 },
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node --env-file-if-exists=.env server/index.ts', url: 'http://127.0.0.1:3000/health', env: { REDIS_NAMESPACE: namespace } },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort', url: 'http://127.0.0.1:5173' },
  ],
});
