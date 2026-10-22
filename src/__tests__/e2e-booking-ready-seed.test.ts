/** @jest-environment node */
/**
 * E2E で「予約できる施設」を seed するときは、スタッフの勤務時間も明示して作る（2026年10月23日）。
 *
 * 20261023080000 から facility_booking_ready は「勤務時間のある在籍スタッフ」を要求し、
 * 20261023080100 からスタッフを作っても勤務は作られない。勤務の無いスタッフだけを入れて
 * confirmSyntheticBookingPreparation を呼ぶと、ヘルパーが
 * 'synthetic facility did not satisfy actual booking readiness' を投げ、beforeAll ごと
 * describe 内の全テストが chromium と webkit の両方で落ちる。
 * 予約準備の変更時に既存の spec は直したが、別の変更で足された e2e/mobile-bottom-bars.spec.ts だけが
 * 漏れていた。ヘルパーを使う spec はすべて勤務の seed を持つことをここで固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const E2E = join(process.cwd(), 'e2e');
const HELPER = 'booking-preparation.seed.ts';
const callers = readdirSync(E2E)
  .filter((file) => file.endsWith('.ts') && file !== HELPER)
  .filter((file) => /confirmSyntheticBookingPreparation\(/.test(readFileSync(join(E2E, file), 'utf8')))
  .sort();

test('走査が空振りしていない（ヘルパーを使う spec が見つかる）', () => {
  expect(callers).toEqual(expect.arrayContaining(['booking.spec.ts', 'mobile-bottom-bars.spec.ts']));
});

test.each(callers)('%s は予約準備の確認より前にスタッフの勤務時間（staff_schedules）を seed する', (file) => {
  const source = readFileSync(join(E2E, file), 'utf8');
  const schedule = source.search(/staff_schedules/);
  expect(schedule).toBeGreaterThanOrEqual(0);
  expect(schedule).toBeLessThan(source.search(/confirmSyntheticBookingPreparation\(/));
});
