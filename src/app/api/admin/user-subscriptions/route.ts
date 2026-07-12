import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import {
  isAllowedSubscriptionStatusTransition,
  SUBSCRIPTION_STATUS_LABEL,
  type SubscriptionStatus,
} from '@/lib/subscription-status';

const grantSchema = z.object({
  facility_id: z.string().uuid(),
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  notes: z.string().max(200).optional(),
});

const useSchema = z.object({
  subscription_id: z.string().uuid(),
  booking_id: z.string().uuid().optional(),
  notes: z.string().max(200).optional(),
});

const updateStatusSchema = z.object({
  subscription_id: z.string().uuid(),
  status: z.enum(['active', 'cancelled', 'paused', 'expired']),
});

async function checkAdminMembership(supabase: Awaited<ReturnType<typeof createServerSupabaseAuthClient>>, userId: string, facilityId: string) {
  const { data } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', userId)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  return !!data;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'user-subscriptions-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  if (userId && !UUID_REGEX.test(userId)) return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 });

  const isAdmin = await checkAdminMembership(supabase, user.id, facilityId);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // profiles(display_name, email) を embed しない：user_subscriptions.user_id は auth.users(id) を参照し
  // user_subscriptions→profiles の FK が無いため、PostgREST が関係を解決できずデータの有無に関わらず
  // 全件エラー(500)になり、サブスク管理ページ全体が LoadError に落ちる実バグだった（user-packages /
  // newsletter と同根）。profiles は user_id で別取得し JS マージしてレスポンス形状を不変に保つ。
  let query = admin
    .from('user_subscriptions')
    .select('*, subscription_plans(name, price, sessions_per_month)')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data: rows, error } = await query.limit(200);
  if (error || !rows) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const profilesById: Record<string, { display_name: string | null; email: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profs, error: profErr } = await admin
      .from('profiles')
      .select('id, display_name, email')
      .in('id', userIds);
    if (profErr || !profs) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    for (const p of profs) profilesById[p.id as string] = { display_name: p.display_name, email: p.email };
  }
  const subscriptions = rows.map((r) => ({ ...r, profiles: profilesById[r.user_id as string] ?? null }));
  return NextResponse.json({ subscriptions });
}

// 管理者がユーザーにサブスクを付与
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'user-subscriptions-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const isAdmin = await checkAdminMembership(supabase, user.id, parsed.data.facility_id);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data: plan } = await admin.from('subscription_plans')
    .select('valid_months')
    .eq('id', parsed.data.plan_id)
    .eq('facility_id', parsed.data.facility_id)
    .single();
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + plan.valid_months);

  const { data, error } = await admin.from('user_subscriptions').insert({
    user_id: parsed.data.user_id,
    facility_id: parsed.data.facility_id,
    plan_id: parsed.data.plan_id,
    ends_at: endsAt.toISOString(),
    notes: parsed.data.notes,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId: parsed.data.facility_id,
    action: 'create',
    tableName: 'user_subscriptions',
    recordId: data.id,
    newValues: { target_user_id: parsed.data.user_id, plan_id: parsed.data.plan_id, notes: parsed.data.notes },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ subscription: data }, { status: 201 });
}

// 1回セッション使用
export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'user-subscriptions-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);

  // ステータス変更
  const statusParsed = updateStatusSchema.safeParse(body);
  if (statusParsed.success && body.status) {
    const admin = createServiceRoleClient();
    const { data: sub } = await admin.from('user_subscriptions').select('facility_id, status').eq('id', statusParsed.data.subscription_id).single();
    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const isAdmin = await checkAdminMembership(supabase, user.id, sub.facility_id);
    if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 状態遷移ガード（SSOT）。現在の状態から到達不可能な遷移は弾く。無条件 update による
    // 不正な巻き戻し（例：解約→一時停止、期限切れ→契約中の無期限復活、同状態の無意味な再書込）を防ぐ。
    const current = sub.status as SubscriptionStatus;
    const next = statusParsed.data.status;
    if (!isAllowedSubscriptionStatusTransition(current, next)) {
      const currentLabel = SUBSCRIPTION_STATUS_LABEL[current] ?? current;
      return NextResponse.json(
        { error: `現在の状態（${currentLabel}）から「${SUBSCRIPTION_STATUS_LABEL[next]}」へは変更できません` },
        { status: 400 },
      );
    }

    const { data, error } = await admin.from('user_subscriptions')
      .update({ status: statusParsed.data.status })
      .eq('id', statusParsed.data.subscription_id)
      .select().maybeSingle();
    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { ip: sip, ua: sua } = getRequestContext(request);
    void writeAuditLog({
      userId: user.id,
      facilityId: sub.facility_id,
      action: 'update',
      tableName: 'user_subscriptions',
      recordId: statusParsed.data.subscription_id,
      newValues: { status: statusParsed.data.status },
      ipAddress: sip,
      userAgent: sua,
    });

    return NextResponse.json({ subscription: data });
  }

  // セッション使用
  const useParsed = useSchema.safeParse(body);
  if (!useParsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data: sub } = await admin
    .from('user_subscriptions')
    .select('*, subscription_plans(sessions_per_month, facility_id)')
    .eq('id', useParsed.data.subscription_id)
    .single();

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const facilityId = (sub.subscription_plans as { facility_id: string } | null)?.facility_id;
  const isAdminUser = facilityId ? await checkAdminMembership(supabase, user.id, facilityId) : false;
  const isOwner = sub.user_id === user.id;
  if (!isOwner && !isAdminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (sub.status !== 'active') return NextResponse.json({ error: 'サブスクリプションが有効ではありません' }, { status: 400 });
  if (sub.ends_at && new Date(sub.ends_at) < new Date()) return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });

  // If a booking_id is supplied, verify it belongs to this subscription's user and facility.
  // This prevents a user from "burning" a session without an actual booking.
  if (useParsed.data.booking_id) {
    const { data: bk } = await admin
      .from('bookings')
      .select('id, user_id, facility_id')
      .eq('id', useParsed.data.booking_id)
      .maybeSingle();
    if (!bk) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }
    // Booking must belong to the subscription's user (self) or the same facility (admin recording)
    const subFacilityId = (sub.subscription_plans as { facility_id: string } | null)?.facility_id;
    const bookingOwnsUser = bk.user_id === sub.user_id;
    const bookingInFacility = subFacilityId ? bk.facility_id === subFacilityId : false;
    if (!bookingOwnsUser && !bookingInFacility) {
      return NextResponse.json({ error: '予約がサブスクリプションと一致しません' }, { status: 400 });
    }

    // 早期リターン用の事前チェック（UX目的・非決定的な多層防御の一部）。
    // 真の冪等性は RPC 内部の行ロック配下チェック（監査D2）が担保する。ここでの
    // TOCTOU（事前SELECTと呼び出しの間の競合）は RPC 側の already_consumed で必ず捕捉される。
    const { data: existingLog } = await admin
      .from('subscription_usage_logs')
      .select('id')
      .eq('subscription_id', useParsed.data.subscription_id)
      .eq('booking_id', useParsed.data.booking_id)
      .limit(1)
      .maybeSingle();
    if (existingLog) {
      return NextResponse.json({ error: 'この予約は既に当月の利用として記録済みです' }, { status: 409 });
    }
  }

  // 監査D2: booking_id 単位の冪等チェック・ログINSERTを RPC 内部（行ロック配下・同一トランザクション）
  // に統合した。従来は RPC 呼び出し後に別途 INSERT していたため、真の同時2リクエストが
  // 両方 RPC を呼んでセッション枠を2回消費した後にログ INSERT の2件目だけが UNIQUE 違反で
  // 弾かれる（枠は既に手遅れ）という欠陥があった。RPC 内で行ロック配下チェックすることで、
  // 後着は先着コミット後にロックを獲得し必ず already_consumed を返す（真の二重消費を根絶）。
  const { data: rpcResult, error: rpcError } = await admin.rpc('consume_subscription_session', {
    p_subscription_id: useParsed.data.subscription_id,
    p_booking_id: useParsed.data.booking_id ?? null,
    p_notes: useParsed.data.notes ?? null,
  });
  if (rpcError) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const result = rpcResult as {
    ok: boolean;
    code?: string;
    limit?: number;
    subscription?: Record<string, unknown>;
  } | null;
  if (!result?.ok) {
    switch (result?.code) {
      case 'not_found':
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      case 'inactive':
        return NextResponse.json({ error: 'サブスクリプションが有効ではありません' }, { status: 400 });
      case 'expired':
        return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });
      case 'cap_reached':
        return NextResponse.json({ error: `今月の利用回数上限（${result.limit ?? ''}回）に達しています` }, { status: 400 });
      case 'already_consumed':
        return NextResponse.json({ error: 'この予約は既に当月の利用として記録済みです' }, { status: 409 });
      default:
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
  }
  const updated = result.subscription;

  return NextResponse.json({ subscription: updated });
}
