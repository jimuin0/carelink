import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';

/**
 * 回数券・月額プランの付与と、契約者一覧に出す表示名・メールの取得（2026年10月22日）。
 *
 * 以前は /api/admin/user-subscriptions・/api/admin/user-packages が付与先の user_id を
 * 「UUID であること」しか確かめずに INSERT し、一覧ではその人の profiles（表示名・メール）を
 * そのまま返していた。誰でも店舗オーナーになれるので、他人の UUID を指定するだけで
 * その人のメールアドレスが読め、その人の /mypage に見覚えのない回数券・プランを出せた。
 *
 * 付与先は「その店舗を予約したことのあるお客様（bookings.user_id）」に限る。判定は
 * service_role 専用の RPC（migration 20261022150000）が、今もその店舗の owner / admin かを
 * 行ロックつきで確かめ直したうえで、INSERT と同じトランザクションで行う。
 */

export type CustomerGrantKind = 'subscription' | 'package';

const ROUTE: Record<CustomerGrantKind, string> = {
  subscription: '/api/admin/user-subscriptions',
  package: '/api/admin/user-packages',
};

const NOT_FOUND_MESSAGE: Record<CustomerGrantKind, string> = {
  subscription: 'プランが見つかりません',
  package: '回数券が見つかりません',
};

/** 付与先がその店舗の予約者でないとき（存在しない UUID も同じ扱い＝存在の有無を漏らさない）。 */
export const NOT_CUSTOMER_MESSAGE = 'この店舗をご予約いただいたことのあるお客様にのみ付与できます';

const grantedRow = z.object({ id: z.string() }).passthrough();
export type GrantedRow = z.infer<typeof grantedRow>;
const grantResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), subscription: grantedRow.optional(), user_package: grantedRow.optional() }),
  z.object({ ok: z.literal(false), code: z.enum(['forbidden', 'plan_not_found', 'package_not_found', 'not_customer']) }),
]);

export async function grantToFacilityCustomer(input: {
  kind: CustomerGrantKind;
  actorId: string;
  facilityId: string;
  userId: string;
  /** subscription なら plan_id、package なら package_id。 */
  itemId: string;
  notes?: string;
}): Promise<GrantedRow | NextResponse> {
  const tag = `admin-${input.kind}-grant`;
  const route = ROUTE[input.kind];
  const db = createServiceRoleClient();
  const common = { p_actor_id: input.actorId, p_facility_id: input.facilityId, p_user_id: input.userId, p_notes: input.notes };
  const { data, error } = input.kind === 'subscription'
    ? await db.rpc('grant_user_subscription_atomic', { ...common, p_plan_id: input.itemId })
    : await db.rpc('grant_user_package_atomic', { ...common, p_package_id: input.itemId });
  if (error) return serverError(`${tag}-rpc`, databaseDiagnostic(error), route);

  const parsed = grantResult.safeParse(data);
  if (!parsed.success) return serverError(`${tag}-result`, new Error('CUSTOMER_GRANT_RESULT_INVALID'), route);
  const result = parsed.data;
  if (!result.ok) {
    if (result.code === 'forbidden') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (result.code === 'not_customer') return NextResponse.json({ error: NOT_CUSTOMER_MESSAGE }, { status: 404 });
    return NextResponse.json({ error: NOT_FOUND_MESSAGE[input.kind] }, { status: 404 });
  }
  const row = input.kind === 'subscription' ? result.subscription : result.user_package;
  if (!row) return serverError(`${tag}-result`, new Error('CUSTOMER_GRANT_RESULT_INVALID'), route);
  return row;
}

export type CustomerProfile = { display_name: string | null; email: string | null };

/**
 * 一覧の各行に付ける表示名・メールを、その店舗の予約者に限って取得する。
 * 予約者でない人（＝以前の不具合で付与された行など）は含まれず、呼び出し側では profiles=null になる。
 * 失敗は握り潰さず `{ error }` で返す（主データの一部なので 0 件に偽装しない）。
 */
export async function loadFacilityCustomerProfiles(input: {
  actorId: string;
  facilityId: string;
  userIds: string[];
}): Promise<{ profiles: Record<string, CustomerProfile> } | { error: Error }> {
  const profiles: Record<string, CustomerProfile> = {};
  if (input.userIds.length === 0) return { profiles };
  const { data, error } = await createServiceRoleClient().rpc('list_facility_customer_profiles', {
    p_actor_id: input.actorId,
    p_facility_id: input.facilityId,
    p_user_ids: input.userIds,
  });
  if (error || !Array.isArray(data)) {
    return { error: error ? databaseDiagnostic(error) : new Error('list_facility_customer_profiles returned no rows') };
  }
  for (const p of data) profiles[p.id] = { display_name: p.display_name, email: p.email };
  return { profiles };
}
