/**
 * B10-14: 並行性検査スクリプトに特定の利用者のホームディレクトリ（/Users/<名前>）を固定しない。
 * 別の人・別の端末では必ず「専用ソケットではない」と誤って止まり、検査が実行できなくなるため。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

test.each([
  'scripts/check-manual-booking-concurrency.mjs',
  'scripts/check-newsletter-delivery-concurrency.mjs',
  'scripts/check-salon-intent-concurrency.mjs',
])('%s は /Users/<名前> を直書きしない', (file) => {
  expect(readFileSync(join(process.cwd(), file), 'utf8')).not.toMatch(/\/Users\/[A-Za-z0-9_-]+\//);
});
