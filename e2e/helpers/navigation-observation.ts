import { test as playwrightTest, type Page } from '@playwright/test';

// Failure-only diagnostics: pathnames and fixed classifications, never query
// values, credentials, response bodies, console text, cookies or browser traces.
export function observeNavigations(test: typeof playwrightTest) {
  const observations = new WeakMap<Page, Record<string, unknown>[]>();
  test.beforeEach(async ({ page }) => {
    const events: Record<string, unknown>[] = [];
    observations.set(page, events);
    const record = (value: Record<string, unknown>) => { if (events.length < 100) events.push({ at: Date.now(), ...value }); };
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) record({ type: 'navigation', path: new URL(request.url()).pathname, method: request.method() });
    });
    page.on('response', response => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) record({ type: 'response', path: new URL(response.url()).pathname, status: response.status() });
    });
    page.on('requestfailed', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) record({ type: 'navigation_failed', path: new URL(request.url()).pathname });
    });
    page.on('pageerror', error => {
      record({ type: 'pageerror', reactCode: /Minified React error #(\d+)/.exec(error.message)?.[1] ?? null,
        transportFailure: /Failed to fetch|Load failed|NetworkError/.test(error.message) });
    });
  });
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus) await info.attach('navigation-observation', {
      body: JSON.stringify({ path: new URL(page.url()).pathname, events: observations.get(page) ?? [],
        rootErrorVisible: await page.getByRole('heading', { name: 'エラーが発生しました', exact: true }).isVisible().catch(() => false) }),
      contentType: 'application/json',
    });
  });
}
