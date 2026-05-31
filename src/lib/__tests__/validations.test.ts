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

  test('携帯番号 4桁入力で 3-1 ハイフン', () => {
    expect(formatPhone('0901')).toBe('090-1');
  });

  test('携帯番号 7桁入力で 3-4 ハイフン', () => {
    expect(formatPhone('0901234')).toBe('090-1234');
  });

  test('携帯番号 070 prefix', () => {
    expect(formatPhone('07012345678')).toBe('070-1234-5678');
  });

  test('携帯番号 050 prefix', () => {
    expect(formatPhone('05012345678')).toBe('050-1234-5678');
  });

  test('固定電話 03 2桁のみ', () => {
    expect(formatPhone('03')).toBe('03');
  });

  test('固定電話 03 6桁以内', () => {
    expect(formatPhone('031234')).toBe('03-1234');
  });

  test('3桁市外局番 6桁以内', () => {
    expect(formatPhone('045123')).toBe('045-123');
  });

  test('非数字を除去', () => {
    expect(formatPhone('abc09012345678')).toBe('090-1234-5678');
  });
});

describe('salonStep1Schema 追加分岐', () => {
  const validData = {
    facility_name: 'テストサロン',
    business_type: 'ヘアサロン',
    representative_name: '山田太郎',
    contact_name: '山田花子',
    email: 'test@example.com',
    phone: '090-1234-5678',
  };

  test('contact_phone 正常', () => {
    const result = salonStep1Schema.safeParse({ ...validData, contact_phone: '03-1234-5678' });
    expect(result.success).toBe(true);
  });

  test('contact_phone 不正でエラー', () => {
    const result = salonStep1Schema.safeParse({ ...validData, contact_phone: 'abc' });
    expect(result.success).toBe(false);
  });

  test('website 正常 URL', () => {
    const result = salonStep1Schema.safeParse({ ...validData, website: 'https://example.com' });
    expect(result.success).toBe(true);
  });
});

describe('salonStep2Schema 追加分岐', () => {
  test('seat_count NaN は通る', () => {
    const result = salonStep2Schema.safeParse({ seat_count: NaN });
    expect(result.success).toBe(true);
  });

  test('seat_count 正常値で通過', () => {
    const result = salonStep2Schema.safeParse({ seat_count: 10, staff_count: 5 });
    expect(result.success).toBe(true);
  });

  test('features 20 件超過でエラー', () => {
    const result = salonStep2Schema.safeParse({ features: Array(21).fill('a') });
    expect(result.success).toBe(false);
  });

  test('postal_code 不正でエラー', () => {
    const result = salonStep2Schema.safeParse({ postal_code: '12' });
    expect(result.success).toBe(false);
  });
});

describe('formatPhone 追加ブランチカバレッジ', () => {
  // Branch coverage: line 55 — その他固定電話 3桁以内はそのまま返す（true 分岐）
  test('3桁市外局番プレフィックス 3桁のみ → そのまま返す（line 55 true 分岐）', () => {
    // '045' → digits='045', not /^0[36]/ match, length=3 → if(3<=3) return '045'
    expect(formatPhone('045')).toBe('045');
  });
});

describe('formatPhone — ^ アンカー必要性の検証（Regex mutation kill）', () => {
  // L43: /^0[5789]0/ → /0[5789]0/ mutation を kill する
  // digits が '0[5789]0' を含むが先頭ではない場合、3-3-4 フォーマットになること
  test('先頭が 1 で途中に 090 がある番号は 3-3-4 形式（^ アンカーが必要）', () => {
    // digits='10901234567' → /^0[5789]0/ 不一致 → /^0[36]/ 不一致 → 3-3-4
    // mutation時 /0[5789]0/ は位置1でマッチ → 誤って 3-4-4 形式 '109-0123-4567' を返す
    expect(formatPhone('1-0901234567')).toBe('109-012-3456');
  });

  // L49: /^0[36]/ → /0[36]/ mutation を kill する
  // digits が '0[36]' を含むが先頭ではない場合、3-3-4 フォーマットになること
  test('先頭が 1 で途中に 03 がある番号は 3-3-4 形式（^ アンカーが必要）', () => {
    // digits='1031234567' → /^0[5789]0/ 不一致 → /^0[36]/ 不一致 → 3-3-4
    // mutation時 /0[36]/ は位置1でマッチ → 誤って 2-4-4 形式 '10-3123-4567' を返す
    expect(formatPhone('1031234567')).toBe('103-123-4567');
  });
});
