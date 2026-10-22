/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 回数券・月額プランの付与先を「その店舗の予約者」に限る経路（2026年10月22日）。
 * 判定そのものは RPC（migration 20261022150000）が行い、実 DB での検証は
 * supabase/shadow/customer-grant-qa-audit-fixtures.sql。ここでは RPC の結果を HTTP へ
 * 正しく対応させているか（特に「予約者でない」を成功扱いにしないか）を固定する。
 */
const mockRpc = jest.fn();
const mockAlert = jest.fn();
jest.mock('../supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
jest.mock('../alert', () => ({ alertCaughtError: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('../safe', () => ({ safeCaptureException: jest.fn() }));

import { NextResponse } from 'next/server';
import { grantToFacilityCustomer, loadFacilityCustomerProfiles, NOT_CUSTOMER_MESSAGE } from '../facility-customer-grant';

const ACTOR = '73000000-0000-4000-8000-000000000001';
const FACILITY = '73000000-0000-4000-8000-000000000002';
const CUSTOMER = '73000000-0000-4000-8000-000000000003';
const ITEM = '73000000-0000-4000-8000-000000000004';
const ROW = '73000000-0000-4000-8000-000000000005';

const base = { actorId: ACTOR, facilityId: FACILITY, userId: CUSTOMER, itemId: ITEM };

beforeEach(() => {
  mockRpc.mockReset();
  mockAlert.mockReset();
});

async function asResponse(value: unknown): Promise<{ status: number; body: unknown }> {
  expect(value).toBeInstanceOf(NextResponse);
  const res = value as NextResponse;
  return { status: res.status, body: await res.json() };
}

describe('grantToFacilityCustomer', () => {
  test('月額プランは grant_user_subscription_atomic に操作者・店舗・付与先・プランを渡し、作った行を返す', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, subscription: { id: ROW, user_id: CUSTOMER } }, error: null });
    const row = await grantToFacilityCustomer({ kind: 'subscription', ...base, notes: 'メモ' });
    expect(row).toEqual({ id: ROW, user_id: CUSTOMER });
    expect(mockRpc).toHaveBeenCalledWith('grant_user_subscription_atomic', {
      p_actor_id: ACTOR, p_facility_id: FACILITY, p_user_id: CUSTOMER, p_notes: 'メモ', p_plan_id: ITEM,
    });
  });

  test('回数券は grant_user_package_atomic に回数券 ID を渡す', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, user_package: { id: ROW, sessions_total: 6 } }, error: null });
    const row = await grantToFacilityCustomer({ kind: 'package', ...base });
    expect(row).toEqual({ id: ROW, sessions_total: 6 });
    expect(mockRpc).toHaveBeenCalledWith('grant_user_package_atomic', {
      p_actor_id: ACTOR, p_facility_id: FACILITY, p_user_id: CUSTOMER, p_notes: undefined, p_package_id: ITEM,
    });
  });

  test('予約したことのない人への付与は 404（存在しないアカウントと区別しない）', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, code: 'not_customer' }, error: null });
    const { status, body } = await asResponse(await grantToFacilityCustomer({ kind: 'subscription', ...base }));
    expect(status).toBe(404);
    expect(body).toEqual({ error: NOT_CUSTOMER_MESSAGE });
    expect(NOT_CUSTOMER_MESSAGE).toBe('この店舗をご予約いただいたことのあるお客様にのみ付与できます');
  });

  test.each([
    ['subscription', 'plan_not_found', 'プランが見つかりません'],
    ['package', 'package_not_found', '回数券が見つかりません'],
  ] as const)('%s: 店舗のものでないプラン／回数券は 404', async (kind, code, message) => {
    mockRpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    const { status, body } = await asResponse(await grantToFacilityCustomer({ kind, ...base }));
    expect(status).toBe(404);
    expect(body).toEqual({ error: message });
  });

  test('権限が外れていたら 403', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, code: 'forbidden' }, error: null });
    const { status, body } = await asResponse(await grantToFacilityCustomer({ kind: 'package', ...base }));
    expect(status).toBe(403);
    expect(body).toEqual({ error: '店舗の管理権限を確認してください' });
  });

  test('RPC の失敗は 500 で通知し、DB のメッセージは通知に載せない（SQLSTATE だけ）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist: secret detail' } });
    const { status } = await asResponse(await grantToFacilityCustomer({ kind: 'subscription', ...base }));
    expect(status).toBe(500);
    expect(mockAlert).toHaveBeenCalledWith('admin-subscription-grant-rpc', new Error('DATABASE_FAILURE:42883'), '/api/admin/user-subscriptions');
  });

  test.each([
    ['形の違う結果', { ok: 'yes' }],
    ['未知のコード', { ok: false, code: 'something_else' }],
    ['結果なし', null],
  ])('%s は成功扱いにせず 500', async (_label, data) => {
    mockRpc.mockResolvedValue({ data, error: null });
    const { status } = await asResponse(await grantToFacilityCustomer({ kind: 'package', ...base }));
    expect(status).toBe(500);
    expect(mockAlert).toHaveBeenCalledWith('admin-package-grant-result', new Error('CUSTOMER_GRANT_RESULT_INVALID'), '/api/admin/user-packages');
  });

  test.each([
    ['subscription', { ok: true, user_package: { id: ROW } }, '/api/admin/user-subscriptions'],
    ['package', { ok: true, subscription: { id: ROW } }, '/api/admin/user-packages'],
    ['package', { ok: true }, '/api/admin/user-packages'],
  ] as const)('%s: 作った行が無い・種類が違う成功は 500', async (kind, data, route) => {
    mockRpc.mockResolvedValue({ data, error: null });
    const { status } = await asResponse(await grantToFacilityCustomer({ kind, ...base }));
    expect(status).toBe(500);
    expect(mockAlert).toHaveBeenCalledWith(`admin-${kind}-grant-result`, new Error('CUSTOMER_GRANT_RESULT_INVALID'), route);
  });
});

describe('loadFacilityCustomerProfiles', () => {
  test('一覧が空なら RPC を呼ばない', async () => {
    expect(await loadFacilityCustomerProfiles({ actorId: ACTOR, facilityId: FACILITY, userIds: [] })).toEqual({ profiles: {} });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('店舗の予約者の分だけ表示名・メールを返す（RPC が返さなかった人は含めない）', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: CUSTOMER, display_name: '予約者', email: 'c@example.invalid' }], error: null });
    const result = await loadFacilityCustomerProfiles({ actorId: ACTOR, facilityId: FACILITY, userIds: [CUSTOMER, ROW] });
    expect(result).toEqual({ profiles: { [CUSTOMER]: { display_name: '予約者', email: 'c@example.invalid' } } });
    expect(mockRpc).toHaveBeenCalledWith('list_facility_customer_profiles', {
      p_actor_id: ACTOR, p_facility_id: FACILITY, p_user_ids: [CUSTOMER, ROW],
    });
  });

  test('RPC の失敗は { error } で返す（0 件に偽装しない）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } });
    expect(await loadFacilityCustomerProfiles({ actorId: ACTOR, facilityId: FACILITY, userIds: [CUSTOMER] }))
      .toEqual({ error: new Error('DATABASE_FAILURE:08006') });
  });

  test('配列でない結果も失敗として返す', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await loadFacilityCustomerProfiles({ actorId: ACTOR, facilityId: FACILITY, userIds: [CUSTOMER] }))
      .toEqual({ error: new Error('list_facility_customer_profiles returned no rows') });
  });
});
