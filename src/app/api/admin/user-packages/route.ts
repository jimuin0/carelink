import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const grantSchema = z.object({
  facility_id: z.string().uuid(),
  user_id: z.string().uuid(),
  package_id: z.string().uuid(),
  notes: z.string().max(200).optional(),
});

const useSchema = z.object({
  user_package_id: z.string().uuid(),
  booking_id: z.string().uuid().optional(),
  notes: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'user-packages-get')) {
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

  const { data: membership } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // profiles(display_name, email) を PostgREST embed しない：user_packages.user_id は auth.users(id) を
  // 参照し user_packages→profiles の FK が無いため、embed すると関係が解決できずデータの有無に関わらず
  // 全件エラー(500)になり、パッケージ管理ページ全体が「読み込みに失敗」表示に落ちる実バグだった
  // （E2E で確定。service_packages は FK 有りで embed 可）。profiles は user_id で別取得し JS マージして
  // レスポンス形状 { ..., service_packages, profiles } を不変に保つ。
  let query = admin
    .from('user_packages')
    .select('*, service_packages(name, session_count, bonus_count)')
    .eq('facility_id', facilityId)
    .order('purchased_at', { ascending: false });

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
    for (const p of profs) {
      profilesById[p.id as string] = { display_name: p.display_name, email: p.email };
    }
  }
  const user_packages = rows.map((r) => ({ ...r, profiles: profilesById[r.user_id as string] ?? null }));
  return NextResponse.json({ user_packages });
}

// 管理者がユーザーに回数券を付与
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'user-packages')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const { data: membership } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', parsed.data.facility_id)
    .in('role', ['owner', 'admin'])
    .single();
  if (!membership) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // パッケージ情報取得
  const { data: pkg } = await admin
    .from('service_packages')
    .select('session_count, bonus_count, valid_days')
    .eq('id', parsed.data.package_id)
    .eq('facility_id', parsed.data.facility_id)
    .single();
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 });

  const totalSessions = pkg.session_count + pkg.bonus_count;
  const expiresAt = new Date(Date.now() + pkg.valid_days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin.from('user_packages').insert({
    user_id: parsed.data.user_id,
    facility_id: parsed.data.facility_id,
    package_id: parsed.data.package_id,
    sessions_total: totalSessions,
    sessions_remaining: totalSessions,
    expires_at: expiresAt,
    notes: parsed.data.notes,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId: parsed.data.facility_id,
    action: 'create',
    tableName: 'user_packages',
    recordId: data.id,
    newValues: { target_user_id: parsed.data.user_id, package_id: parsed.data.package_id, sessions_total: totalSessions, notes: parsed.data.notes },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ user_package: data }, { status: 201 });
}

// 回数券を1回使用（booking時に呼び出す）
export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'user-packages-use')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = useSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();

  // 回数券の所有権確認
  const { data: userPkg } = await admin
    .from('user_packages')
    .select('*, service_packages(facility_id)')
    .eq('id', parsed.data.user_package_id)
    .single();

  if (!userPkg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 施設管理者 or 本人のみ
  const facilityId = (userPkg.service_packages as { facility_id: string } | null)?.facility_id;
  const isOwner = userPkg.user_id === user.id;
  let isAdmin = false;
  if (facilityId) {
    const { data: m } = await supabase
      .from('facility_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('facility_id', facilityId)
      .in('role', ['owner', 'admin'])
      .single();
    isAdmin = !!m;
  }
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 早期リターン用の事前チェック（UX目的・非決定的な多層防御の一部）。読み取り時点の値に基づく
  // ため TOCTOU の余地はあるが、真の冪等性・原子性は下の RPC 内部（行ロック配下）が担保する。
  if (userPkg.sessions_remaining <= 0) {
    return NextResponse.json({ error: '残り回数がありません' }, { status: 400 });
  }
  if (userPkg.expires_at && new Date(userPkg.expires_at) < new Date()) {
    return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });
  }

  // 冪等化（二重消費防止）事前チェック: 同一 booking_id で既に消費済みなら減算しない。
  // 「1回使用」ボタンの連打/リトライで顧客の前払い分が二重に減るのを防ぐ（逐次再呼び出し対策）。
  // ここでの TOCTOU（事前SELECTと呼び出しの間の競合）は RPC 側の already_consumed で必ず捕捉される。
  if (parsed.data.booking_id) {
    const { data: existingLog } = await admin
      .from('package_usage_logs')
      .select('id')
      .eq('user_package_id', parsed.data.user_package_id)
      .eq('booking_id', parsed.data.booking_id)
      .limit(1)
      .maybeSingle();
    if (existingLog) {
      return NextResponse.json({ error: 'この予約は既に回数券を消費済みです' }, { status: 409 });
    }
  }

  // 恒久修正（金銭二重消費の根治）: 従来は CAS decrement 成功後に package_usage_logs へ
  // 別クエリで INSERT していたため、ログ INSERT だけが失敗すると「減算は済んだがログが無い」
  // 状態になり、上の事前チェックがログ行の有無で判定する冪等性を偽装して二重消費を許した。
  // consume_package_session RPC（行ロック配下で冪等チェック→decrement→ログINSERTを同一
  // トランザクション化・姉妹の consume_subscription_session と同型）に集約し、
  // ログ INSERT が失敗すれば decrement ごとロールバックされる構造にした。
  const { data: rpcResult, error: rpcError } = await admin.rpc('consume_package_session', {
    p_user_package_id: parsed.data.user_package_id,
    p_booking_id: parsed.data.booking_id ?? null,
    p_notes: parsed.data.notes ?? null,
  });
  if (rpcError) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const result = rpcResult as {
    ok: boolean;
    code?: string;
    user_package?: Record<string, unknown>;
  } | null;
  if (!result?.ok) {
    switch (result?.code) {
      case 'not_found':
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      case 'no_sessions_remaining':
        return NextResponse.json({ error: '残り回数がありません' }, { status: 400 });
      case 'expired':
        return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });
      case 'already_consumed':
        return NextResponse.json({ error: 'この予約は既に回数券を消費済みです' }, { status: 409 });
      default:
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
  }

  return NextResponse.json({ user_package: result.user_package });
}
