import { fieldMatches, cronMatches, jobsDueAt } from '../cron-schedule.mjs';
import { CRON_JOBS } from '../cron-jobs';

// UTC 基準の固定日付。2026-07-05 は日曜(getUTCDay=0)、2026-07-06 は月曜(=1)。
// テスト前提が崩れたら即落ちるよう二重確認する。
const SUNDAY = { y: 2026, mo: 6, d: 5 }; // month は 0-index（6=July）
const MONDAY = { y: 2026, mo: 6, d: 6 };
const WEDNESDAY = { y: 2026, mo: 6, d: 1 }; // 2026-07-01 は水曜(=3)

function at(day: { y: number; mo: number; d: number }, h: number, m: number): Date {
  return new Date(Date.UTC(day.y, day.mo, day.d, h, m, 0));
}

describe('cron-schedule 前提の健全性', () => {
  it('固定日付の曜日が想定通り（テスト前提の自己検証）', () => {
    expect(at(SUNDAY, 0, 0).getUTCDay()).toBe(0);
    expect(at(MONDAY, 0, 0).getUTCDay()).toBe(1);
    expect(at(WEDNESDAY, 0, 0).getUTCDay()).toBe(3);
  });

  it('CRON_JOBS の全式で dom と dow の少なくとも一方が * （AND評価の前提）', () => {
    for (const j of CRON_JOBS) {
      const [, , dom, , dow] = j.schedule.split(/\s+/);
      expect(dom === '*' || dow === '*').toBe(true);
    }
  });
});

describe('fieldMatches', () => {
  it('* は常に true', () => {
    expect(fieldMatches('*', 0)).toBe(true);
    expect(fieldMatches('*', 59)).toBe(true);
  });

  it('単一値: 一致で true・不一致で false', () => {
    expect(fieldMatches('15', 15)).toBe(true);
    expect(fieldMatches('15', 16)).toBe(false);
  });

  it('リスト: いずれかに一致で true・全不一致で false', () => {
    expect(fieldMatches('7,37', 7)).toBe(true);
    expect(fieldMatches('7,37', 37)).toBe(true);
    expect(fieldMatches('7,37', 8)).toBe(false);
  });

  it('*/n: n の倍数で true・非倍数で false', () => {
    expect(fieldMatches('*/15', 0)).toBe(true);
    expect(fieldMatches('*/15', 15)).toBe(true);
    expect(fieldMatches('*/15', 45)).toBe(true);
    expect(fieldMatches('*/15', 7)).toBe(false);
  });

  it('*/n: n が不正（0・非数）はマッチさせない（誤発火防止）', () => {
    expect(fieldMatches('*/0', 0)).toBe(false);
    expect(fieldMatches('*/abc', 0)).toBe(false);
  });

  it('範囲 a-b: 範囲内で true・範囲外で false', () => {
    expect(fieldMatches('1-5', 3)).toBe(true);
    expect(fieldMatches('1-5', 1)).toBe(true);
    expect(fieldMatches('1-5', 5)).toBe(true);
    expect(fieldMatches('1-5', 6)).toBe(false);
  });

  it('範囲 a-b: 端が非数はマッチさせない', () => {
    expect(fieldMatches('a-5', 3)).toBe(false);
    expect(fieldMatches('1-b', 3)).toBe(false);
  });

  it('単一値: 非数はマッチさせない', () => {
    expect(fieldMatches('xx', 3)).toBe(false);
  });

  it('複合: リスト内に範囲と単一が混在', () => {
    expect(fieldMatches('1-5,10', 4)).toBe(true);
    expect(fieldMatches('1-5,10', 10)).toBe(true);
    expect(fieldMatches('1-5,10', 8)).toBe(false);
  });
});

describe('cronMatches', () => {
  it('フィールド数が 5 でない式は false（誤発火防止）', () => {
    expect(cronMatches('0 15 * *', at(SUNDAY, 15, 0))).toBe(false); // 4個
    expect(cronMatches('0 15 * * * *', at(SUNDAY, 15, 0))).toBe(false); // 6個
  });

  it('日次 "0 15 * * *": 15:00 のみ true', () => {
    expect(cronMatches('0 15 * * *', at(WEDNESDAY, 15, 0))).toBe(true);
    expect(cronMatches('0 15 * * *', at(WEDNESDAY, 15, 1))).toBe(false);
    expect(cronMatches('0 15 * * *', at(WEDNESDAY, 14, 0))).toBe(false);
  });

  it('毎時 "0 * * * *": 毎時 0 分で true', () => {
    expect(cronMatches('0 * * * *', at(WEDNESDAY, 3, 0))).toBe(true);
    expect(cronMatches('0 * * * *', at(WEDNESDAY, 3, 30))).toBe(false);
  });

  it('リスト分 "7,37 * * * *": :07 と :37 で true', () => {
    expect(cronMatches('7,37 * * * *', at(WEDNESDAY, 9, 7))).toBe(true);
    expect(cronMatches('7,37 * * * *', at(WEDNESDAY, 9, 37))).toBe(true);
    expect(cronMatches('7,37 * * * *', at(WEDNESDAY, 9, 8))).toBe(false);
  });

  it('15分毎 "*/15 * * * *": :00/:15/:30/:45 で true', () => {
    for (const m of [0, 15, 30, 45]) {
      expect(cronMatches('*/15 * * * *', at(WEDNESDAY, 12, m))).toBe(true);
    }
    expect(cronMatches('*/15 * * * *', at(WEDNESDAY, 12, 7))).toBe(false);
  });

  it('週次日曜 "0 7 * * 0": 日曜 07:00 のみ true・月曜は false', () => {
    expect(cronMatches('0 7 * * 0', at(SUNDAY, 7, 0))).toBe(true);
    expect(cronMatches('0 7 * * 0', at(MONDAY, 7, 0))).toBe(false);
  });

  it('週次月曜 "0 15 * * 1": 月曜 15:00 のみ true・日曜は false', () => {
    expect(cronMatches('0 15 * * 1', at(MONDAY, 15, 0))).toBe(true);
    expect(cronMatches('0 15 * * 1', at(SUNDAY, 15, 0))).toBe(false);
  });
});

describe('jobsDueAt', () => {
  it('該当時刻に実行すべきジョブ名のみ返す', () => {
    // 水曜 15:00 UTC → booking-reminder(0 15 * * *) と webhook-retry(*/15 の :00) が due。
    const due = jobsDueAt(CRON_JOBS, at(WEDNESDAY, 15, 0));
    expect(due).toContain('booking-reminder');
    expect(due).toContain('webhook-retry'); // */15 の 0 分
    expect(due).not.toContain('cron-heartbeat'); // 7,37 分のみ
  });

  it('日曜 07:00 UTC → customer-segment が due', () => {
    const due = jobsDueAt(CRON_JOBS, at(SUNDAY, 7, 0));
    expect(due).toContain('customer-segment'); // 0 7 * * 0
  });

  it('該当なしの時刻は空配列', () => {
    // 水曜 03:08 UTC → 0分でも 7,37 でも */15 でもない
    expect(jobsDueAt(CRON_JOBS, at(WEDNESDAY, 3, 8))).toEqual([]);
  });
});
