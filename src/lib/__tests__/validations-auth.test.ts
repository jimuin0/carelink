import { loginSchema, signupSchema } from '../validations-auth';

describe('loginSchema', () => {
  const valid = { email: 'test@example.com', password: '12345678' };

  test('正常データが通過する', () => {
    expect(loginSchema.safeParse(valid).success).toBe(true);
  });

  test('メールアドレスが不正だとエラー', () => {
    expect(loginSchema.safeParse({ ...valid, email: 'invalid' }).success).toBe(false);
  });

  test('パスワード7文字はエラー', () => {
    expect(loginSchema.safeParse({ ...valid, password: '1234567' }).success).toBe(false);
  });

  test('パスワード8文字はOK', () => {
    expect(loginSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true);
  });

  test('メールが空だとエラー', () => {
    expect(loginSchema.safeParse({ ...valid, email: '' }).success).toBe(false);
  });
});

describe('signupSchema', () => {
  const valid = {
    display_name: 'テスト太郎',
    email: 'test@example.com',
    password: '12345678',
    password_confirm: '12345678',
  };

  test('正常データが通過する', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  test('表示名が空だとエラー', () => {
    expect(signupSchema.safeParse({ ...valid, display_name: '' }).success).toBe(false);
  });

  test('パスワード不一致だとエラー', () => {
    const result = signupSchema.safeParse({ ...valid, password_confirm: 'different' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('パスワードが一致しません');
    }
  });

  test('メールアドレスが不正だとエラー', () => {
    expect(signupSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  test('パスワードが短いとエラー', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short', password_confirm: 'short' }).success).toBe(false);
  });
});
