import { expect, type Page } from '@playwright/test';

/** A streamed document can show the real dashboard before unrelated modules finish loading. */
export async function waitForVisibleDashboard(page:Page){
  await page.waitForURL(url=>url.pathname==='/admin',{waitUntil:'commit'});
  // A committed URL or Next loading fallback is never sufficient.
  await expect(page.getByRole('heading',{name:'ダッシュボード',exact:true})).toBeVisible();
}
