import { defineConfig } from '@playwright/test';
import original from './playwright.config';

const mobileSafari = original.projects?.find(project => project.name === 'Mobile Safari');
if (!mobileSafari) throw new Error('Cloudflare draft regression requires the original Mobile Safari project');

export default defineConfig({
  ...original,
  // Regress the first-visit banner/draft interaction without retries, as well
  // as the full original suite. Native-event diagnostics retain no draft data.
  projects: [...(original.projects ?? []), {
    name: 'Mobile Safari draft deletion repeat',
    use: mobileSafari.use,
    testMatch: /salon-local-draft\.spec\.ts$/,
    grep: /different manual input/,
    repeatEach: 30,
    retries: 0,
  }],
  webServer: process.env.CI ? {
    command: 'node cloudflare/start-ci-https.mjs',
    url: 'https://localhost:3000',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  } : undefined,
});
