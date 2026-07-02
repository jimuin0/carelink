import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

const VALID_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const ticketUpdateSchema = z.object({
  ticket_status: z.enum(VALID_STATUSES).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  ticket_notes: z.string().max(2000).optional().nullable(),
});

// contacts はプラットフォーム宛の問い合わせで facility_id 列を持たない（一覧も施設横断で表示）。
// 旧実装は facility_members による施設スコープ認可＋contacts.facility_id 絞りだったが、
// (1) contacts に facility_id 列が無く UPDATE が常に失敗、(2) 呼び出し側が facility_id を
// 送らないため常に 401、と二重に壊れていた。プラットフォーム管理者認可（registrations 等と
// 同方式）に統一し、id のみで更新する。
async function getPlatformAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_platform_admin ? user.id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-inquiries-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const adminUserId = await getPlatformAdminUser();
  if (!adminUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = ticketUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const payload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.ticket_status === 'resolved') {
    payload.resolved_at = new Date().toISOString();
  } else if (parsed.data.ticket_status !== undefined) {
    // resolved から別状態へ戻す(再オープン)ときは resolved_at を消し、古い解決日時が残らないようにする。
    payload.resolved_at = null;
  }

  const admin = createServiceRoleClient();
  // contacts は施設横断のプラットフォーム問い合わせ。プラットフォーム管理者のみ到達できるため id で更新。
  // .select('id') で更新行を取得し、0 行なら存在しない ID として 404 を返す
  // （旧実装は 0 行でも ok:true を返し「幻の成功」になっていた = ADM-INQ-1）。
  const { data: updated, error } = await admin
    .from('contacts')
    .update(payload)
    .eq('id', params.id)
    .select('id');

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'チケットが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
