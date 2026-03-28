import { salonStep1Schema, salonStep2Schema, salonStep3Schema, formatPhone } from '../validations';

describe('salonStep1Schema', () => {
  const validData = {
    facility_name: 'テストサロン',
    business_type: 'ヘアサロン',
    representative_name: '山田太郎',
    contact_name: '山田花子',
    email: 'test@example.com',
    phone: '090-1234-5678',
  };

  test('正常データが通過する', () => {
    const result = salonStep1Schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test('施設名が空だとエラー', () => {
    const result = salonStep1Schema.safeParse({ ...validData, facility_name: '' });
    expect(result.success).toBe(false);
  });

  test('メールアドレスが不正だとエラー', () => {
    const result = salonStep1Schema.safeParse({ ...validData, email: 'invalid' });
    expect(result.success).toBe(false);
  });

  test('電話番号が不正だとエラー', () => {
    const result = salonStep1Schema.safeParse({ ...validData, phone: 'abc' });
    expect(result.success).toBe(false);
  });

  test('ハイフンなし電話番号も通過する', () => {
    const result = salonStep1Schema.safeParse({ ...validData, phone: '09012345678' });
    expect(result.success).toBe(true);
  });

  test('ウェブサイトURLが不正だとエラー', () => {
    const result = salonStep1Schema.safeParse({ ...validData, website: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  test('ウェブサイト空文字はOK', () => {
    const result = salonStep1Schema.safeParse({ ...validData, website: '' });
    expect(result.success).toBe(true);
  });
});

describe('salonStep2Schema', () => {
  test('空オブジェクトが通過する（全フィールド任意）', () => {
    const result = salonStep2Schema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('郵便番号が正しい形式で通過する', () => {
    const result = salonStep2Schema.safeParse({ postal_code: '5600001' });
    expect(result.success).toBe(true);
  });

  test('郵便番号ハイフン付きも通過する', () => {
    const result = salonStep2Schema.safeParse({ postal_code: '560-0001' });
    expect(result.success).toBe(true);
  });

  test('座席数が負の値だとエラー', () => {
    const result = salonStep2Schema.safeParse({ seat_count: -1 });
    expect(result.success).toBe(false);
  });
});

describe('salonStep3Schema', () => {
  test('PR文が1001文字だとエラー', () => {
    const result = salonStep3Schema.safeParse({ pr_text: 'あ'.repeat(1001) });
    expect(result.success).toBe(false);
  });

  test('PR文が1000文字は通過する', () => {
    const result = salonStep3Schema.safeParse({ pr_text: 'あ'.repeat(1000) });
    expect(result.success).toBe(true);
  });
});

describe('formatPhone', () => {
  test('携帯番号 090-1234-5678', () => {
    expect(formatPhone('09012345678')).toBe('090-1234-5678');
  });

  test('携帯番号 080', () => {
    expect(formatPhone('08012345678')).toBe('080-1234-5678');
  });

  test('固定電話 03-1234-5678', () => {
    expect(formatPhone('0312345678')).toBe('03-1234-5678');
  });

  test('固定電話 06-1234-5678', () => {
    expect(formatPhone('0612345678')).toBe('06-1234-5678');
  });

  test('3桁市外局番 045-123-4567', () => {
    expect(formatPhone('0451234567')).toBe('045-123-4567');
  });

  test('ハイフン除去して再フォーマット', () => {
    expect(formatPhone('090-1234-5678')).toBe('090-1234-5678');
  });

  test('短い入力はそのまま返す', () => {
    expect(formatPhone('090')).toBe('090');
  });
});
