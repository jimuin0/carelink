import { csvEscape } from '../csv';

describe('csvEscape', () => {
  test('プレーン文字列はそのまま', () => {
    expect(csvEscape('山田太郎')).toBe('山田太郎');
  });

  test('数値は文字列化', () => {
    expect(csvEscape(5)).toBe('5');
    expect(csvEscape(0)).toBe('0');
  });

  test('null/undefined は空文字', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  test.each(['=cmd', '+1', '-1', '@SUM', '|pipe'])(
    '数式トリガ先頭 %s は \' を前置して無効化',
    (val) => {
      expect(csvEscape(val)).toBe(`'${val}`);
    },
  );

  test('カンマを含む値はクォート', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  test('ダブルクォートを含む値はクォートし内部は "" にエスケープ', () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
  });

  test('改行を含む値はクォート', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  test('数式トリガかつカンマ＝先頭無効化後にクォート', () => {
    expect(csvEscape('=a,b')).toBe('"\'=a,b"');
  });
});
