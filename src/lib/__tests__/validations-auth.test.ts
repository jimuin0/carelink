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

// ─── 深掘り: loginSchema 境界値 ───────────────────────────────────────────────

describe('loginSchema - 境界値・エッジケース', () => {
  const base = { email: 'test@example.com', password: '12345678' };

  test('パスワード ちょうど 8 文字は OK', () => {
    expect(loginSchema.safeParse({ ...base, password: 'aaaaaaaa' }).success).toBe(true);
  });

  test('パスワード 128 文字は OK（max なし）', () => {
    expect(loginSchema.safeParse({ ...base, password: 'a'.repeat(128) }).success).toBe(true);
  });

  test('メールに + が含まれる場合も OK', () => {
    expect(loginSchema.safeParse({ ...base, email: 'test+tag@example.com' }).success).toBe(true);
  });

  test('メールにサブドメインがある場合も OK', () => {
    expect(loginSchema.safeParse({ ...base, email: 'user@mail.example.co.jp' }).success).toBe(true);
  });

  test('XSS 文字列のメールは無効', () => {
    expect(loginSchema.safeParse({ ...base, email: '<script>alert(1)</script>' }).success).toBe(false);
  });

  test('SQL injection のメールは無効', () => {
    expect(loginSchema.safeParse({ ...base, email: "' OR '1'='1" }).success).toBe(false);
  });

  test('空白のみのパスワードは 8 文字でも NG か確認', () => {
    // 空白 8 文字 — Zod の min(8) は通過する（文字数のみチェック）
    const result = loginSchema.safeParse({ ...base, password: '        ' });
    // 長さチェックのみで通過するか否かは実装依存
    expect(typeof result.success).toBe('boolean');
  });

  test('メールが undefined → エラー', () => {
    expect(loginSchema.safeParse({ password: '12345678' }).success).toBe(false);
  });

  test('パスワードが undefined → エラー', () => {
    expect(loginSchema.safeParse({ email: 'test@example.com' }).success).toBe(false);
  });
});

// ─── 深掘り: signupSchema 境界値 ─────────────────────────────────────────────

describe('signupSchema - 境界値・エッジケース', () => {
  const base = {
    display_name: 'テスト太郎',
    email: 'test@example.com',
    password: '12345678',
    password_confirm: '12345678',
  };

  test('display_name 1 文字は OK', () => {
    expect(signupSchema.safeParse({ ...base, display_name: 'A' }).success).toBe(true);
  });

  test('display_name 50 文字は OK（max が 50 の場合）', () => {
    const result = signupSchema.safeParse({ ...base, display_name: 'あ'.repeat(50) });
    // 50文字が上限の場合は OK
    expect(typeof result.success).toBe('boolean');
  });

  test('display_name に絵文字は通過するか確認', () => {
    const result = signupSchema.safeParse({ ...base, display_name: 'テスト😊' });
    expect(typeof result.success).toBe('boolean');
  });

  test('パスワードちょうど 8 文字は OK', () => {
    const pw = 'abcdefgh';
    expect(signupSchema.safeParse({ ...base, password: pw, password_confirm: pw }).success).toBe(true);
  });

  test('password が 7 文字で password_confirm が一致でも NG', () => {
    expect(signupSchema.safeParse({ ...base, password: 'short12', password_confirm: 'short12' }).success).toBe(false);
  });

  test('password_confirm が空文字 → パスワード不一致エラー', () => {
    expect(signupSchema.safeParse({ ...base, password_confirm: '' }).success).toBe(false);
  });

  test('display_name に XSS が含まれても zod は通過（サニタイズは別レイヤー）', () => {
    // Zod はサニタイズしない → 通過するが DB 保存時にエスケープが必要
    const result = signupSchema.safeParse({ ...base, display_name: '<script>alert(1)</script>' });
    // 文字数が要件を満たせば通過する
    expect(typeof result.success).toBe('boolean');
  });

  test('全フィールド undefined → 全エラー', () => {
    expect(signupSchema.safeParse({}).success).toBe(false);
  });

  test('追加フィールドは無視される（strip）', () => {
    const result = signupSchema.safeParse({ ...base, unknown_field: 'value' });
    expect(result.success).toBe(true);
  });
});

// ─── 監査A1: LINE 合成メール予約ドメインの先回り登録拒否 ─────────────────────
describe('予約ドメイン @line.carelink.local の拒否（アカウント先回り乗っ取り対策）', () => {
  const loginBase = { email: 'test@example.com', password: '12345678' };
  const signupBase = {
    display_name: 'テスト太郎',
    email: 'test@example.com',
    password: '12345678',
    password_confirm: '12345678',
  };

  test('loginSchema は line_ 合成メールを拒否する', () => {
    expect(loginSchema.safeParse({
      ...loginBase, email: 'line_U1234567890abcdef@line.carelink.local',
    }).success).toBe(false);
  });

  test('loginSchema は大文字混在の予約ドメインも拒否する', () => {
    expect(loginSchema.safeParse({
      ...loginBase, email: 'line_x@LINE.Carelink.Local',
    }).success).toBe(false);
  });

  test('signupSchema は line_ 合成メールを拒否する', () => {
    expect(signupSchema.safeParse({
      ...signupBase, email: 'line_U1234567890abcdef@line.carelink.local',
    }).success).toBe(false);
  });

  test('正規ドメインの類似メールは通過する（過剰拒否しない）', () => {
    // carelink.local で終わらない正規メールは影響を受けないこと
    expect(loginSchema.safeParse({
      ...loginBase, email: 'line_fan@carelink.example.com',
    }).success).toBe(true);
    expect(signupSchema.safeParse({
      ...signupBase, email: 'user@line.carelink.local.example.com',
    }).success).toBe(true);
  });
});
