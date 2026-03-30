jest.mock('resend', () => ({ Resend: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { esc, formatDate, formatTime } from '../email';

describe('esc', () => {
  test('アンパサンドをエスケープ', () => {
    expect(esc('A&B')).toBe('A&amp;B');
  });

  test('<>をエスケープ', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  test('ダブルクォートをエスケープ', () => {
    expect(esc('say "hello"')).toBe('say &quot;hello&quot;');
  });

  test("シングルクォートをエスケープ", () => {
    expect(esc("it's")).toBe("it&#39;s");
  });

  test('空文字列はそのまま', () => {
    expect(esc('')).toBe('');
  });

  test('エスケープ不要な文字はそのまま', () => {
    expect(esc('テスト太郎')).toBe('テスト太郎');
  });

  test('複数の特殊文字を同時にエスケープ', () => {
    expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('formatDate', () => {
  test('日付を日本語フォーマットに変換（曜日付き）', () => {
    // 2026-03-30 は月曜日
    expect(formatDate('2026-03-30')).toBe('2026年3月30日（月）');
  });

  test('日曜日', () => {
    // 2026-03-29 は日曜日
    expect(formatDate('2026-03-29')).toBe('2026年3月29日（日）');
  });

  test('1月1日（木曜日）', () => {
    // 2026-01-01 は木曜日
    expect(formatDate('2026-01-01')).toBe('2026年1月1日（木）');
  });

  test('12月31日', () => {
    // 2025-12-31 は水曜日
    expect(formatDate('2025-12-31')).toBe('2025年12月31日（水）');
  });
});

describe('formatTime', () => {
  test('秒付き時刻から秒を除去', () => {
    expect(formatTime('10:30:00')).toBe('10:30');
  });

  test('秒なし時刻はそのまま', () => {
    expect(formatTime('09:00')).toBe('09:00');
  });

  test('深夜時刻', () => {
    expect(formatTime('00:00:00')).toBe('00:00');
  });
});
