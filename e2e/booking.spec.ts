import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { confirmSyntheticBookingPreparation } from './booking-preparation.seed';

// Listing-only stores are valid. A known ready synthetic fixture avoids both
// an arbitrary first result and assertions that silently skip when none exists.
test.describe('予約フロー（UI確認）', () => {
  let slug: string;
  test.beforeAll(async () => {
    if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
      || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
      || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000') {
      throw new Error('booking UI fixture requires the managed disposable CI lifecycle');
    }
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    slug = `synthetic-booking-ui-${randomUUID()}`;
    const facility = await db.from('facility_profiles').insert({ name: '合成予約UI確認店', slug,
      business_type: 'ヘアサロン', prefecture: '東京都', city: '検証市', address: '合成町1', status: 'published' })
      .select('id').single();
    if (facility.error || !facility.data) throw new Error('synthetic booking facility setup failed');
    const id = facility.data.id;
    const menu = await db.from('facility_menus').insert({ facility_id: id, name: '合成カット',
      category: 'カット', price: 5000, duration_minutes: 60, is_published: true });
    const staff = await db.from('staff_profiles').insert({ facility_id: id, name: '合成スタッフ',
      slug: `${slug}-staff`, is_active: true });
    if (menu.error || staff.error) throw new Error('synthetic booking catalog setup failed');
    await confirmSyntheticBookingPreparation(db, id);
  });

  test('施設詳細ページが表示される', async ({ page }) => {
    await page.goto(`/facility/${slug}`);
    await expect(page.getByRole('heading', { name: '合成予約UI確認店', exact: true })).toBeVisible();
  });

  test('予約ページへのリンクが存在する', async ({ page }) => {
    await page.goto(`/facility/${slug}`);
    const bookingLink = page.locator(`a[href="/facility/${slug}/booking"]`).first();
    await expect(bookingLink).toBeVisible();
    await bookingLink.click();
    await expect(page.getByRole('button', { name: /合成カット/ })).toBeVisible();
  });
});

test.describe('予約フォーム', () => {
  test('未ログインでは認証ページにリダイレクト', async ({ page }) => {
    await page.goto('/mypage/bookings');
    await expect(page).toHaveURL(/\/auth\/login\?redirect=/);
  });
});
