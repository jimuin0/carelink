/** @jest-environment node */
/**
 * 店舗向けの説明が、リマインドの実際の送信時刻と食い違わないことを固定する（2026年10月22日）。
 *
 * 【神原さん決定】リマインドは朝9時（JST）に1回だけ送る（src/lib/reminder-schedule.ts）。
 * メール本文にはそう書くようにしたのに、管理画面のマニュアルには「24時間前に自動で送信」と
 * 残っており、お客様に届く説明と店舗が読む説明が食い違っていた。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { REMINDER_SEND_HOUR_JST } from '@/lib/reminder-schedule';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('管理画面のマニュアルは朝9時の送信と、9時以降の翌日予約には前日リマインドが届かないことを書く', () => {
  const manual = read('src/app/admin/manual/page.tsx');
  expect(manual).not.toContain('24時間前');
  expect(manual).toContain(`前日の朝${REMINDER_SEND_HOUR_JST}時に`);
  expect(manual).toContain(`前日の朝${REMINDER_SEND_HOUR_JST}時より後に入った翌日のご予約には、前日のリマインドは届きません`);
});

test('リマインダー設定の画面にも送信時刻を書く', () => {
  expect(read('src/components/admin/ReminderUpsellSettings.tsx')).toContain(`リマインドは毎朝${REMINDER_SEND_HOUR_JST}時に`);
});
