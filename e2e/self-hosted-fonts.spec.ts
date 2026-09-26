import { test, expect } from '@playwright/test';

test('registration uses the bundled Japanese fonts without a Google Fonts dependency', async ({ page }) => {
  const externalFonts: string[] = [];
  const fontResponses: { origin: string; status: number }[] = [];
  page.on('request', request => {
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url()).hostname)) {
      externalFonts.push(new URL(request.url()).hostname);
    }
  });
  page.on('response', response => {
    if (response.request().resourceType() === 'font') {
      fontResponses.push({ origin: new URL(response.url()).origin, status: response.status() });
    }
  });
  await page.goto('/register');
  await expect(page.locator('h1')).toBeVisible();
  const loaded = await page.evaluate(async () => {
    const body = getComputedStyle(document.body).fontFamily;
    const heading = getComputedStyle(document.querySelector('h1')!).fontFamily;
    const fonts = await Promise.all([
      document.fonts.load('400 16px "Noto Sans JP Variable"', '施設予約'),
      document.fonts.load('700 16px "Noto Sans JP Variable"', '施設予約'),
      document.fonts.load('400 30px "Noto Serif JP Variable"', '予約、集客'),
      document.fonts.load('500 30px "Noto Serif JP Variable"', '予約、集客'),
    ]);
    return { body, heading, faces: fonts.map(values => values.map(face => face.status)) };
  });
  expect(loaded.body).toContain('Noto Sans JP Variable');
  expect(loaded.heading).toContain('Noto Serif JP Variable');
  for (const faces of loaded.faces) {
    expect(faces.length).toBeGreaterThan(0); // An absent face must not pass via fallback.
    expect(faces.every(status => status === 'loaded')).toBe(true);
  }
  expect(fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.every(response => response.origin === new URL(page.url()).origin && response.status === 200)).toBe(true);
  expect(externalFonts).toEqual([]);
});
