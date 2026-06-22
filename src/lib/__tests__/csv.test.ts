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

  // --- CSV インジェクション: TAB/CR 先頭（OWASP 準拠・Excel/Sheets が空白剥がし後に数式評価） ---
  test('先頭 TAB のセルは \' を前置して無効化', () => {
    // \t は数式トリガではないがクォート条件にも該当しないため、結果は "'\t..." そのまま
    expect(csvEscape('\t=cmd')).toBe("'\t=cmd");
  });

  test('先頭 CR のセルは \' を前置し、CR を含むためクォートもされる', () => {
    // 先頭 \r → 数式トリガとして \' 前置 → さらに \r を含むので RFC4180 クォート
    expect(csvEscape('\r=cmd')).toBe('"\'\r=cmd"');
  });

  test('先頭 TAB のみ（数式なし）でも \' を前置', () => {
    expect(csvEscape('\tplain')).toBe("'\tplain");
  });

  // --- CR を含む値は改行扱いでクォート（行分断防止・RFC4180） ---
  test('CRLF を含む値はクォート（先頭が数式トリガでない場合）', () => {
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });

  test('値中（先頭以外）の CR 単体もクォートされる', () => {
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });

  // --- 先頭空白後の数式は無効化されない（既知の許容・空白は数式起動しない） ---
  test('半角スペース先頭は数式トリガ扱いしない（スペースは Excel が剥がさない）', () => {
    expect(csvEscape(' =cmd')).toBe(' =cmd');
  });
});
