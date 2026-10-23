/** @jest-environment node */
/**
 * 顧客一覧（/admin/customers）は顧客台帳を全件読む（2026年10月23日）。
 *
 * 一覧だけが台帳をページングせずに読んでいたため、PostgREST の上限（1000 行）で切れ、台帳が 1000 件を
 * 超える店舗では、全件を読む顧客詳細（getLedgerCustomerVisits）・RFM 集計 cron と、電話番号での来店の
 * 寄せ方（ledgerPhoneLinks）が食い違った。一覧は全件読みの getFacilityCustomerLedger だけを使うこと。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('顧客一覧は台帳を全件読みのヘルパーで読み、customers を直接（1 回きりの select で）読まない', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/admin/customers/page.tsx'), 'utf8');
  expect(page).toContain('await getFacilityCustomerLedger(facilityId)');
  expect(page).not.toMatch(/from\(\s*['"]customers['"]\s*\)/);
});
