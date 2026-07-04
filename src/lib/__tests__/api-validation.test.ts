/**
 * @jest-environment node
 */
import { z } from 'zod';
import { zodErrorResponse } from '../api-validation';

const schema = z.object({
  name: z.string().min(1, 'お名前は必須です'),
  phone: z.string().regex(/^0\d{8,10}$/, '正しい電話番号を入力してください'),
});

describe('zodErrorResponse', () => {
  test('最初のフィールドエラーメッセージを error に載せる（監査F2/F3）', async () => {
    const parsed = schema.safeParse({ name: '', phone: 'bad' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const res = zodErrorResponse(parsed.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    // 汎用文言ではなく具体的なフィールドメッセージが返ること
    expect(body.error).not.toBe('リクエストが不正です');
    expect(['お名前は必須です', '正しい電話番号を入力してください']).toContain(body.error);
    // 構造化 details も含むこと
    expect(body.details.fieldErrors).toBeDefined();
  });

  test('status を上書きできる', async () => {
    const parsed = schema.safeParse({ name: '', phone: '0123456789' });
    if (parsed.success) throw new Error('should fail');
    const res = zodErrorResponse(parsed.error, 422);
    expect(res.status).toBe(422);
  });
});
