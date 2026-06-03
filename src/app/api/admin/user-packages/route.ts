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
  let query = admin
    .from('user_packages')
    .select('*, service_packages(name, session_count, bonus_count), profiles(display_name, email)')
    .eq('facility_id', facilityId)
    .order('purchased_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ user_packages: data });
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

  if (userPkg.sessions_remaining <= 0) {
    return NextResponse.json({ error: '残り回数がありません' }, { status: 400 });
  }
  if (userPkg.expires_at && new Date(userPkg.expires_at) < new Date()) {
    return NextResponse.json({ error: '有効期限が切れています' }, { status: 400 });
  }

  // Atomic decrement: require sessions_remaining matches what we read (optimistic lock)
  // Prevents double-debit if two concurrent requests race past the > 0 check above.
  const { data: updated, error } = await admin
    .from('user_packages')
    .update({ sessions_remaining: userPkg.sessions_remaining - 1 })
    .eq('id', parsed.data.user_package_id)
    .eq('sessions_remaining', userPkg.sessions_remaining)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!updated) return NextResponse.json({ error: '残り回数がありません（同時更新が発生しました）' }, { status: 409 });

  // ログ記録
  const { error: logErr } = await admin.from('package_usage_logs').insert({
    user_package_id: parsed.data.user_package_id,
    booking_id: parsed.data.booking_id ?? null,
    notes: parsed.data.notes,
  });
  if (logErr) {
    console.error('[user-packages] usage log insert failed', { userPackageId: parsed.data.user_package_id, err: logErr });
  }

  return NextResponse.json({ user_package: updated });
}
