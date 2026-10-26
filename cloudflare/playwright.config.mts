import { defineConfig } from '@playwright/test';
import original from './playwright.config';

export default defineConfig({
  ...original,
  webServer: process.env.CI ? {
    command: 'node cloudflare/start-ci-https.mjs',
    url: 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  } : undefined,
});
