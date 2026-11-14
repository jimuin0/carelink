// 写しではなく本物のスキーマを検証する（点検 A56：写しは trim・max・nullable を欠き、
// 本物と逆の結果を主張していた）。
import { facilityInquirySchema as inquirySchema } from '@/lib/validations-inquiry';

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

  test('B5-14: 全角数字・全角ハイフンの電話番号は半角へ正規化して通過する', () => {
    const r = inquirySchema.safeParse({ ...validData, phone: '０９０ー１２３４ー５６７８' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.phone).toBe('090-1234-5678');
  });

  test('固定電話番号が通過する', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '03-1234-5678' }).success).toBe(true);
  });

  test('電話番号省略時（undefined）もOK', () => {
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

  test('名前が全角スペースのみだとエラー（trim 後に空）', () => {
    expect(inquirySchema.safeParse({ ...validData, name: '　' }).success).toBe(false);
  });

  test('名前・本文は前後の空白を落として返す', () => {
    const r = inquirySchema.safeParse({ ...validData, name: ' 神原 ', message: '　本文　' });
    expect(r.success && r.data).toMatchObject({ name: '神原', message: '本文' });
  });

  test('本文が空白だけだとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, message: ' 　 ' }).success).toBe(false);
  });

  test.each([
    ['name', 'あ'.repeat(100), 'あ'.repeat(101)],
    ['email', `${'a'.repeat(242)}@example.com`, `${'a'.repeat(243)}@example.com`],
  ])('%s の上限（境界値は通過・超過はエラー）', (field, ok, ng) => {
    expect(inquirySchema.safeParse({ ...validData, [field]: ok }).success).toBe(true);
    expect(inquirySchema.safeParse({ ...validData, [field]: ng }).success).toBe(false);
  });

  test('電話番号が20文字を超えるとエラー', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: '0' + '1'.repeat(20) }).success).toBe(false);
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

  test('phone が null でも通過する（未入力として nullable）', () => {
    expect(inquirySchema.safeParse({ ...validData, phone: null }).success).toBe(true);
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
