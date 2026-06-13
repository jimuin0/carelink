import { todayJst, isValidIsoDate, clampPage, addDays, diffDays } from '../admin-date';

describe('todayJst', () => {
  it('JST の今日を YYYY-MM-DD 形式で返す', () => {
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getTodayString（JST 集約ソース）と一致する', () => {
    // 単一ソースへ委譲していることの保証（UTC 独自実装への退行を防ぐ）
    const { getTodayString } = require('../validations-booking');
    expect(todayJst()).toBe(getTodayString());
  });
});

describe('isValidIsoDate', () => {
  it('形式不正は false（区切り違い）', () => {
    expect(isValidIsoDate('2026/01/15')).toBe(false);
  });

  it('形式不正は false（文字列）', () => {
    expect(isValidIsoDate('abc')).toBe(false);
  });

  it('月範囲外で Invalid Date になる日付は false（2026-13-01）', () => {
    expect(isValidIsoDate('2026-13-01')).toBe(false);
  });

  it('日=00 は false（2026-02-00）', () => {
    expect(isValidIsoDate('2026-02-00')).toBe(false);
  });

  it('暦上存在しない日（ロールオーバーする）は false（2026-02-30）', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });

  it('非うるう年の 2/29 は false（2026-02-29）', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
  });

  it('4/31 は false（2026-04-31）', () => {
    expect(isValidIsoDate('2026-04-31')).toBe(false);
  });

  it('実在する日付は true（2026-01-15）', () => {
    expect(isValidIsoDate('2026-01-15')).toBe(true);
  });

  it('うるう年の 2/29 は true（2028-02-29）', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
});

describe('clampPage', () => {
  it('未指定（undefined）は 1', () => {
    expect(clampPage(undefined, 5)).toBe(1);
  });

  it('不正値（数値化不能）は 1', () => {
    expect(clampPage('abc', 5)).toBe(1);
  });

  it('空文字は 1', () => {
    expect(clampPage('', 5)).toBe(1);
  });

  it('1未満（0）は 1 にクランプ', () => {
    expect(clampPage('0', 5)).toBe(1);
  });

  it('負数は 1 にクランプ', () => {
    expect(clampPage('-3', 5)).toBe(1);
  });

  it('範囲内はそのまま', () => {
    expect(clampPage('3', 5)).toBe(3);
  });

  it('totalPages 超過は最終ページにクランプ（?page=999）', () => {
    expect(clampPage('999', 3)).toBe(3);
  });

  it('totalPages が 0 でも下限 1 を保証', () => {
    expect(clampPage('2', 0)).toBe(1);
  });
});

describe('addDays', () => {
  it('正の加算', () => {
    expect(addDays('2026-06-13', 1)).toBe('2026-06-14');
  });

  it('月跨ぎ', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });

  it('年跨ぎ', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('0 は同日', () => {
    expect(addDays('2026-06-13', 0)).toBe('2026-06-13');
  });

  it('負の加算（前日）', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
  });

  it('うるう年 2/28→2/29', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('diffDays', () => {
  it('同日は 0', () => {
    expect(diffDays('2026-06-13', '2026-06-13')).toBe(0);
  });

  it('翌日は +1', () => {
    expect(diffDays('2026-06-13', '2026-06-14')).toBe(1);
  });

  it('過去日は負', () => {
    expect(diffDays('2026-06-13', '2026-06-11')).toBe(-2);
  });

  it('月跨ぎの差', () => {
    expect(diffDays('2026-06-30', '2026-07-02')).toBe(2);
  });

  it('時刻成分を持たないため UTC/JST 境界に依存しない（addDays と整合）', () => {
    const base = '2026-06-13';
    expect(diffDays(base, addDays(base, 3))).toBe(3);
    expect(diffDays(base, addDays(base, -5))).toBe(-5);
  });
});
