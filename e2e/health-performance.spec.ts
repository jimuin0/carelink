import { test, expect } from '@playwright/test';
import { healthPerformanceDiagnostic } from './helpers/health-performance-diagnostic';

// Worker-scoped trace options must be configured at file level.
// This file contains only anonymous local health performance requests.
test.use({ trace: 'retain-on-failure' });

test.describe('API レスポンスタイム', () => {
  test('/api/health が 500ms 以内に応答する', async ({ request }, testInfo) => {
    const start = Date.now();
    const response = await request.get('/api/health');
    const elapsed = Date.now() - start;
    if (elapsed >= 500 || response.status() !== 200) {
      const body: unknown = await response.json().catch(() => null);
      const diagnostic = healthPerformanceDiagnostic(elapsed, response.status(), body, response.headers()['server-timing'] ?? null);
      await testInfo.attach('health-performance-diagnostic', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
    }
    expect(response.status()).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});
