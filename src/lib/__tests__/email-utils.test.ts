jest.mock('resend', () => ({ Resend: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

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

describe('escSubject', () => {
  const { escSubject } = require('../email');

  test('改行文字をスペースに置換', () => {
    expect(escSubject('件名\nインジェクション')).toBe('件名 インジェクション');
  });

  test('キャリッジリターンをスペースに置換', () => {
    expect(escSubject('件名\rインジェクション')).toBe('件名 インジェクション');
  });

  test('タブをスペースに置換', () => {
    expect(escSubject('件名\ttest')).toBe('件名 test');
  });

  test('200文字を超えるとスライスされる', () => {
    const long = 'あ'.repeat(300);
    expect(escSubject(long).length).toBe(200);
  });

  test('200文字ちょうどはそのまま通る', () => {
    const s = 'a'.repeat(200);
    expect(escSubject(s).length).toBe(200);
  });

  test('正常な件名はそのまま', () => {
    expect(escSubject('予約確認メール')).toBe('予約確認メール');
  });
});

describe('formatDate — edge cases', () => {
  test('うるう年2月29日', () => {
    // 2028-02-29 は火曜日
    expect(formatDate('2028-02-29')).toBe('2028年2月29日（火）');
  });

  test('1桁の月・日', () => {
    // 2026-05-03 は日曜日
    expect(formatDate('2026-05-03')).toMatch(/5月3日/);
  });

  test('土曜日', () => {
    // 2026-04-18 は土曜日
    expect(formatDate('2026-04-18')).toBe('2026年4月18日（土）');
  });
});

describe('formatTime — edge cases', () => {
  test('23:59:59', () => {
    expect(formatTime('23:59:59')).toBe('23:59');
  });

  test('秒だけ異なる', () => {
    expect(formatTime('12:00:30')).toBe('12:00');
  });
});

describe('esc — additional XSS vectors', () => {
  test('バックスラッシュはエスケープ不要', () => {
    expect(esc('foo\\bar')).toBe('foo\\bar');
  });

  test('数字はそのまま', () => {
    expect(esc('123')).toBe('123');
  });

  test('& が複数あっても全て置換', () => {
    expect(esc('a&b&c')).toBe('a&amp;b&amp;c');
  });

  test('< と > が混在', () => {
    expect(esc('1 < 2 > 0')).toBe('1 &lt; 2 &gt; 0');
  });
});
