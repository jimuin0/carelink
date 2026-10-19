import { z } from 'zod';
import { validateCouponDiscountFields, normalizeCouponDiscountFields, validateCouponDates, normalizeCouponDateFields } from '../coupon-validation';

// admin coupons API（POST/PATCH）と同じ形で zod に組み込んで検証する。
const schema = z.object({
  discount_type: z.enum(['fixed', 'percentage', 'special_price']).optional(),
  discount_value: z.number().int().optional().nullable(),
  special_price: z.number().int().optional().nullable(),
}).superRefine(validateCouponDiscountFields).transform(normalizeCouponDiscountFields);

describe('validateCouponDiscountFields（discount_type×値の相互必須）', () => {
  // ─── fixed ───────────────────────────────────────────────
  test.each([
    [null, false], [undefined, false], [0, false], [1, true], [100000, true], [100001, false], [-1, false],
  ])('fixed: discount_value=%p → valid=%p', (dv, expected) => {
    const r = schema.safeParse({ discount_type: 'fixed', discount_value: dv });
    expect(r.success).toBe(expected);
  });

  // ─── percentage ──────────────────────────────────────────
  test.each([
    [null, false], [undefined, false], [0, false], [1, true], [100, true], [101, false], [-1, false],
  ])('percentage: discount_value=%p → valid=%p', (dv, expected) => {
    const r = schema.safeParse({ discount_type: 'percentage', discount_value: dv });
    expect(r.success).toBe(expected);
  });

  // ─── special_price ───────────────────────────────────────
  test.each([
    [null, false], [undefined, false], [0, false], [1, true], [9999999, true], [10000000, false], [-1, false],
  ])('special_price: special_price=%p → valid=%p', (sp, expected) => {
    const r = schema.safeParse({ discount_type: 'special_price', special_price: sp });
    expect(r.success).toBe(expected);
  });

  // ─── discount_type 未指定（PATCH部分更新） ─────────────────
  test('discount_type 未指定＋値も未指定 → valid（name等のみの部分更新を許可）', () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  test('discount_type 未指定＋discount_value あり → invalid（型不明のまま値だけ更新は不整合の素通り）', () => {
    expect(schema.safeParse({ discount_value: 150 }).success).toBe(false);
  });

  test('discount_type 未指定＋discount_value: null → invalid（nullも「値の変更」として型の同時指定を要求）', () => {
    expect(schema.safeParse({ discount_value: null }).success).toBe(false);
  });

  test('discount_type 未指定＋special_price あり → invalid', () => {
    expect(schema.safeParse({ special_price: 500 }).success).toBe(false);
  });

  test('エラーメッセージが discount_type 併記要求である', () => {
    const r = schema.safeParse({ discount_value: 150 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain('discount_type');
      expect(r.error.issues[0].path).toEqual(['discount_type']);
    }
  });
});

describe('normalizeCouponDiscountFields（型に対応しない側の列を null へ正規化）', () => {
  test('fixed: special_price に値が入っていても null に落ちる', () => {
    const r = schema.parse({ discount_type: 'fixed', discount_value: 500, special_price: 3000 });
    expect(r).toEqual({ discount_type: 'fixed', discount_value: 500, special_price: null });
  });

  test('percentage: special_price に値が入っていても null に落ちる', () => {
    const r = schema.parse({ discount_type: 'percentage', discount_value: 20, special_price: 3000 });
    expect(r).toEqual({ discount_type: 'percentage', discount_value: 20, special_price: null });
  });

  test('special_price: discount_value に値が入っていても null に落ちる', () => {
    const r = schema.parse({ discount_type: 'special_price', discount_value: 500, special_price: 3000 });
    expect(r).toEqual({ discount_type: 'special_price', discount_value: null, special_price: 3000 });
  });

  test('fixed: special_price 未指定（undefined）→ null が明示され DB 上も確実にクリアされる', () => {
    const r = schema.parse({ discount_type: 'fixed', discount_value: 500 });
    expect(r.special_price).toBeNull();
    expect(r.discount_value).toBe(500);
  });

  test('special_price: discount_value 未指定（undefined）→ null が明示される', () => {
    const r = schema.parse({ discount_type: 'special_price', special_price: 3000 });
    expect(r.discount_value).toBeNull();
    expect(r.special_price).toBe(3000);
  });

  test('discount_type 未指定 → 値列に一切触れない（部分更新で意図せぬ null 上書きをしない）', () => {
    const r = schema.parse({});
    expect('discount_value' in r).toBe(false);
    expect('special_price' in r).toBe(false);
  });

  test('normalizeCouponDiscountFields 単体: discount_type が null 相当（undefined）はそのまま返す', () => {
    const input = { discount_value: undefined, special_price: undefined };
    expect(normalizeCouponDiscountFields(input)).toBe(input);
  });

  // schema 経由では superRefine が先に落ちて到達できない undefined→null フォールバック分岐を
  // 関数単体で直接検証する（防御コードの分岐カバレッジ確保）。
  test('normalizeCouponDiscountFields 単体: fixed で discount_value undefined → null に明示化', () => {
    const r = normalizeCouponDiscountFields({ discount_type: 'fixed' });
    expect(r.discount_value).toBeNull();
    expect(r.special_price).toBeNull();
  });

  test('normalizeCouponDiscountFields 単体: special_price 型で special_price undefined → null に明示化', () => {
    const r = normalizeCouponDiscountFields({ discount_type: 'special_price' });
    expect(r.discount_value).toBeNull();
    expect(r.special_price).toBeNull();
  });
});

const dateSchema=z.object({valid_from:z.unknown().optional(),valid_until:z.unknown().optional()}).superRefine(validateCouponDates);
test.each([
 [{},true],[{valid_from:null,valid_until:''},true],[{valid_from:'2026-01-01'},true],[{valid_until:'2026-01-01'},true],
 [{valid_from:'2026-01-01',valid_until:'2026-01-01'},true],[{valid_from:'2026-01-02',valid_until:'2026-01-01'},false],
 [{valid_from:42},false],[{valid_until:{}},false],[{valid_from:'not-a-date'},false],[{valid_from:'0000-01-01'},false],
 [{valid_from:'2026-02-30'},false],[{valid_from:'2026-01-01T99:00Z'},false],
 [{valid_from:'2026-01-01T23:00:00-05:00',valid_until:'2026-01-02'},true],
])('coupon calendar dates %p are valid=%s', (fields,valid)=>expect(dateSchema.safeParse(fields).success).toBe(valid));
test.each([{}, {valid_from:undefined,valid_until:undefined},{valid_from:null,valid_until:null},{valid_from:'',valid_until:''},{valid_from:'2026-01-01',valid_until:'2026-12-31'}])('coupon empty date clears normalize without adding omitted fields %p',fields=>{
 const source=fields as {valid_from?:string|null;valid_until?:string|null};const result=normalizeCouponDateFields(source);for(const key of ['valid_from','valid_until'] as const){if(source[key]===undefined)expect(result[key]).toBeUndefined();else expect(result[key]).toBe(source[key] || null);}
});
