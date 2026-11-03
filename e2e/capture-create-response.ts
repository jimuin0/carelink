import type { Page, Route } from '@playwright/test';

// Read the one real upstream response before forwarding it unchanged to the UI.
// Playwright's browser Response.body() can remain pending for streamed Worker
// responses even after the UI received the successful response.
export async function captureCreateResponse(page: Page, path: string, trigger: () => Promise<void>) {
  let observed: { status: number; body: unknown } | undefined;
  let finish!: () => void;
  const forwarded = new Promise<void>(resolve => { finish = resolve; });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== path) return route.continue();
    const response = await route.fetch();
    observed = { status: response.status(), body: await response.json() };
    await route.fulfill({ response });
    finish();
  };
  await page.route(`**${path}**`, handler);
  try {
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST'),
      trigger(),
      forwarded,
    ]);
    if (!observed) throw new Error(`No creation response captured for ${path}`);
    return observed;
  } finally {
    await page.unroute(`**${path}**`, handler);
  }
}
