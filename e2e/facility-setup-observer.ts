import { expect, type Page, type Route } from '@playwright/test';

// Observe the real authorized API transaction before delivering its unchanged
// response. A successful setup replaces the document, so Chromium can discard
// the response body before waitForResponse(...).json() reads it. Do not mock a
// success, repeat the POST or bypass authentication to work around navigation.
export async function observeFacilitySetup(page: Page, submit: () => Promise<unknown>) {
  const pattern = '**/api/facility/setup';
  let observed: { status: number; body: Record<string, unknown> } | undefined;
  let failure: unknown;
  let requests = 0;
  let settled = false;
  const handler = async (route: Route) => {
    if (settled) {
      await route.fallback();
      return;
    }
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests += 1;
    try {
      const response = await route.fetch({ maxRetries: 0 });
      const body = await response.json();
      await route.fulfill({ response });
      observed = { status: response.status(), body };
    } catch (error) {
      failure = error;
      await route.abort('connectionfailed');
    }
  };
  await page.route(pattern, handler);
  try {
    await submit();
    await expect.poll(() => observed !== undefined || failure !== undefined, { timeout: 30_000 }).toBe(true);
    if (failure !== undefined) throw failure;
    expect(requests).toBe(1);
    return observed!;
  } finally {
    // Do not unroute here: the successful setup is replacing the document right now. Removing the
    // last route turns off Chromium's interception, and a request caught by that switch (seen: the
    // page stylesheet) never finishes, so the page stays on its loading fallback for good.
    // The route goes away with the page; until then it only passes requests on.
    settled = true;
  }
}
