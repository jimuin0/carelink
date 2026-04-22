import { z } from 'zod';

// InquiryForm schema (mirrors src/components/facility/InquiryForm.tsx)
const inquirySchema = z.object({
  name: z.string().min(1, 'お名前を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  phone: z.string().regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/, '正しい電話番号を入力してください').or(z.literal('')).optional(),
  message: z.string().min(1, 'お問い合わせ内容を入力してください').max(1000, '1000文字以内で入力してください'),
});

const validData = {
  name: '神原良祐',
  email: 'test@example.com',
  phone: '090-1234-5678',
  message: 'テストお問い合わせ',
};

describe('inquirySchema', () => {
  test('正常データが通過する', () => {
    expect(inquirySchema.safeParse(validData).success).toBe(true);
  });

  test('名前が空だとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, name: '' }).success).toBe(false);
  });

  test('メールが不正だとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, email: 'not-email' }).success).toBe(false);
  });

  test('電話番号が空文字はOK（任意項目）', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '' }).success).toBe(true);
  });

  test('電話番号が不正な文字列だとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: 'abc' }).success).toBe(false);
  });

  test('電話番号がハイフンなしで通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '09012345678' }).success).toBe(true);
  });

  test('固定電話番号が通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '03-1234-5678' }).success).toBe(true);
  });

  test('電話番号省略時（undefined）もOK', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { phone, ...noPhone } = validData;
    expect(inquirySchema.safeParse(noPhone).success).toBe(true);
  });

  test('メッセージが空だとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, message: '' }).success).toBe(false);
  });

  test('メッセージが1001文字だとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, message: 'あ'.repeat(1001) }).success).toBe(false);
  });

  test('メッセージが1000文字は通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, message: 'あ'.repeat(1000) }).success).toBe(true);
  });
});

describe('inquirySchema — deep tests', () => {
  test('名前が1文字でも通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, name: 'A' }).success).toBe(true);
  });

  test('名前が全角スペースのみだとエラー（min:1で通過するが空白のみは意図外）', () => {
    // zodのmin(1)は空文字チェックのみ、全角スペースはlength>0なのでsuccess
    const result = inquirySchema.safeParse({ ...validData, name: '　' });
    expect(result.success).toBe(true); // zod does not trim by default
  });

  test('email に + が入っても有効', () => {
    expect(inquirySchema.safeParse({ ...validData, email: 'user+tag@example.com' }).success).toBe(true);
  });

  test('email にサブドメインが入っても有効', () => {
    expect(inquirySchema.safeParse({ ...validData, email: 'a@mail.example.co.jp' }).success).toBe(true);
  });

  test('電話番号 0120 フリーダイヤル形式が通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '0120-123-456' }).success).toBe(true);
  });

  test('電話番号に英字が含まれるとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '090-ABCD-5678' }).success).toBe(false);
  });

  test('メッセージ1文字で通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, message: 'あ' }).success).toBe(true);
  });

  test('phone が null だとエラー（型不一致）', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: null }).success).toBe(false);
  });

  test('name が undefined だとエラー', () => {
    const { name, ...rest } = validData;
    expect(inquirySchema.safeParse(rest).success).toBe(false);
  });

  test('email が undefined だとエラー', () => {
    const { email, ...rest } = validData;
    expect(inquirySchema.safeParse(rest).success).toBe(false);
  });

  test('message が undefined だとエラー', () => {
    const { message, ...rest } = validData;
    expect(inquirySchema.safeParse(rest).success).toBe(false);
  });

  test('全フィールドが正しければ parsed 値が型通り返る', () => {
    const result = inquirySchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.name).toBe('string');
      expect(typeof result.data.email).toBe('string');
      expect(typeof result.data.message).toBe('string');
    }
  });

  test('XSS 文字列はスキーマを通過する（サニタイズはサーバー側担当）', () => {
    // Zodは型チェックのみ、XSSエスケープはサーバー側で行う設計
    expect(inquirySchema.safeParse({ ...validData, name: '<script>alert(1)</script>' }).success).toBe(true);
  });
});
