/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/entitlements.ts
 *  - facility_id → 購入済みオプション Set のマップ構築
 *  - .in() chunk 分割（500件超）
 *  - DB エラー時 fail-safe（未購入扱い＋errors 返却）
 *  - hasEntitlement の真偽
 */

import { getEntitlementsByFacility, hasEntitlement, type EntitlementsClient } from '../entitlements';

type Row = { facility_id: string; option_key: string };

function makeClient(
  pages: { data: Row[] | null; error?: unknown }[],
): { client: EntitlementsClient; calls: { chunk: string[] }[] } {
  const calls: { chunk: string[] }[] = [];
  let i = 0;
  const client: EntitlementsClient = {
    from: () => ({
      select: () => ({
        in: (_col: string, values: string[]) => ({
          eq: () => {
            calls.push({ chunk: values });
            const page = pages[Math.min(i, pages.length - 1)];
            i++;
            return Promise.resolve({ data: page.data, error: page.error ?? null });
          },
        }),
      }),
    }),
  };
  return { client, calls };
}

describe('getEntitlementsByFacility', () => {
  test('facility ごとに option_key の Set を構築する（同一施設に複数行）', async () => {
    const { client } = makeClient([{
      data: [
        { facility_id: 'f1', option_key: 'reminder_line' },
        { facility_id: 'f1', option_key: 'reminder_email_3d' },
        { facility_id: 'f2', option_key: 'time_adjust_line' },
      ],
    }]);
    const { map, errors } = await getEntitlementsByFacility(client, ['f1', 'f2']);
    expect(errors).toHaveLength(0);
    expect(map.get('f1')).toEqual(new Set(['reminder_line', 'reminder_email_3d']));
    expect(map.get('f2')).toEqual(new Set(['time_adjust_line']));
  });

  test('facilityIds は重複排除され、500 件超は chunk 分割される', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `f${i}`);
    const withDup = [...ids, 'f0', 'f1'];
    const { client, calls } = makeClient([{ data: [] }]);
    await getEntitlementsByFacility(client, withDup);
    expect(calls).toHaveLength(2); // 500 + 1
    expect(calls[0].chunk).toHaveLength(500);
    expect(calls[1].chunk).toHaveLength(1);
  });

  test('DB エラー chunk は errors に積んで続行（fail-safe=未購入扱い）', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `f${i}`);
    const { client } = makeClient([
      { data: null, error: { message: 'down' } },
      { data: [{ facility_id: 'f500', option_key: 'reminder_line' }] },
    ]);
    const { map, errors } = await getEntitlementsByFacility(client, ids);
    expect(errors).toHaveLength(1);
    expect(map.get('f0')).toBeUndefined(); // エラー chunk → 未購入扱い
    expect(map.get('f500')).toEqual(new Set(['reminder_line']));
  });

  test('data null（エラーなし）は空扱い', async () => {
    const { client } = makeClient([{ data: null }]);
    const { map, errors } = await getEntitlementsByFacility(client, ['f1']);
    expect(errors).toHaveLength(0);
    expect(map.size).toBe(0);
  });
});

describe('hasEntitlement', () => {
  test('購入済み → true', async () => {
    const { client } = makeClient([{ data: [{ facility_id: 'f1', option_key: 'reminder_line' }] }]);
    expect(await hasEntitlement(client, 'f1', 'reminder_line')).toBe(true);
  });

  test('別オプションのみ購入 → false', async () => {
    const { client } = makeClient([{ data: [{ facility_id: 'f1', option_key: 'reminder_email_3d' }] }]);
    expect(await hasEntitlement(client, 'f1', 'reminder_line')).toBe(false);
  });

  test('行なし（未購入施設）→ false（?? false 分岐）', async () => {
    const { client } = makeClient([{ data: [] }]);
    expect(await hasEntitlement(client, 'f1', 'reminder_line')).toBe(false);
  });
});
