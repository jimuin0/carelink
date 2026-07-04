import { normalizePhone, phoneField, phoneRegex } from '../phone';

describe('normalizePhone', () => {
  test('全角数字を半角化する', () => {
    expect(normalizePhone('０９０１２３４５６７８')).toBe('09012345678');
  });

  test('全角ハイフンを半角ハイフンに統一する', () => {
    expect(normalizePhone('090－1234－5678')).toBe('090-1234-5678');
  });

  test('各種ダッシュ・長音記号をハイフンに統一する', () => {
    expect(normalizePhone('090ー1234−5678')).toBe('090-1234-5678');
    expect(normalizePhone('03–1234—5678')).toBe('03-1234-5678');
  });

  test('半角/全角スペースを除去する', () => {
    expect(normalizePhone('090 1234 5678')).toBe('09012345678');
    expect(normalizePhone('090　1234　5678')).toBe('09012345678');
  });

  test('正当な半角番号は不変（冪等）', () => {
    expect(normalizePhone('090-1234-5678')).toBe('090-1234-5678');
    expect(normalizePhone(normalizePhone('０９０-1234-5678'))).toBe('090-1234-5678');
  });

  test('空文字は空文字のまま', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('phoneField（任意）', () => {
  const schema = phoneField();

  test('全角入力を正規化して検証を通す（監査F1の根治）', () => {
    const r = schema.safeParse('０９０１２３４５６７８');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('09012345678');
  });

  test('空文字を許容する', () => {
    expect(schema.safeParse('').success).toBe(true);
  });

  test('null / undefined を許容する', () => {
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  test('不正な形式は拒否する', () => {
    expect(schema.safeParse('12345').success).toBe(false);
    expect(schema.safeParse('内線1234').success).toBe(false);
  });
});

describe('phoneField（必須）', () => {
  const schema = phoneField({ required: true });

  test('全角必須入力を正規化して通す', () => {
    const r = schema.safeParse('０３－１２３４－５６７８');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('03-1234-5678');
  });

  test('空文字は必須違反で拒否する', () => {
    expect(schema.safeParse('').success).toBe(false);
  });
});

describe('phoneRegex', () => {
  test('正規の日本の番号を受理する', () => {
    expect(phoneRegex.test('09012345678')).toBe(true);
    expect(phoneRegex.test('090-1234-5678')).toBe(true);
    expect(phoneRegex.test('03-1234-5678')).toBe(true);
  });

  test('先頭0でない/文字混じりは拒否する', () => {
    expect(phoneRegex.test('9012345678')).toBe(false);
    expect(phoneRegex.test('+81-90-1234-5678')).toBe(false);
  });
});
