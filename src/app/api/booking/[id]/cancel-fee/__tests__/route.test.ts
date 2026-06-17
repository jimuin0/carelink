/**
 * @jest-environment node
 *
 * キャンセル料機能は現在無効（非表示）。POST は常に 404 を返す。
 * 再有効化時は route.ts のコメント参照（facility_cancel_policies 対応＋料金仕様の確定）。
 */

import { POST } from '../route';

describe('POST /api/booking/[id]/cancel-fee（無効化）', () => {
  it('機能無効のため 404 を返す', async () => {
    const res = await POST();
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('この機能は現在ご利用いただけません');
  });
});
