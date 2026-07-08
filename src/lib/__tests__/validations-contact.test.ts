import { contactSchema } from '../validations-contact';

describe('contactSchema', () => {
  const validData = {
    name: '山田太郎',
    email: 'test@example.com',
    phone: '090-1234-5678',
    inquiry_type: 'その他',
    message: 'テストメッセージです',
  };

  test('正常データが通過する', () => {
    expect(contactSchema.safeParse(validData).success).toBe(true);
  });

  test('お名前が空だとエラー', () => {
    expect(contactSchema.safeParse({ ...validData, name: '' }).success).toBe(false);
  });

  test('内容が空だとエラー', () => {
    expect(contactSchema.safeParse({ ...validData, message: '' }).success).toBe(false);
  });

  // 【2026年7月8日 恒久根治の回帰防止】.trim() 追加前は "   "(空白のみ)が min(1) を素通りし、
  // スペースのみの名前・内容が保存され得た。
  test('お名前がスペースのみだとエラー', () => {
    expect(contactSchema.safeParse({ ...validData, name: '   ' }).success).toBe(false);
  });

  test('内容がスペースのみだとエラー', () => {
    expect(contactSchema.safeParse({ ...validData, message: '   ' }).success).toBe(false);
  });

  test('お名前・内容の前後空白はトリムされて保存される', () => {
    const result = contactSchema.safeParse({ ...validData, name: '  山田太郎  ', message: '  テスト  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('山田太郎');
      expect(result.data.message).toBe('テスト');
    }
  });
});
