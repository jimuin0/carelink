import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

// お客様カルテのメモ/タグ/次回案内（#42-#45）。
// 顧客テーブルが無いため (facility_id, customer_key) で1行管理。customer_key は予約集計と同じ
// 「email もしくは氏名を小文字化した値」。当該施設の予約に実在する顧客のみ参照/更新できる。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const noteSchema = z.object({
  note: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().min(1).max(30)).max(20).optional(),
  next_visit_date: z.string().regex(DATE_RE).optional().nullable().refine(
    (s) => { if (!s) return true; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
    '日付が不正です',
  ),
  next_visit_note: z.string().max(200).optional().nullable(),
});

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).single();
  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

// 予約集計と同一のキー（email優先・なければ氏名）を小文字化
function bookingKey(b: { email: string | null; customer_name: string | null }): string {
  return (b.email || b.customer_name || '').toLowerCase();
}

// 当該施設の予約に customer_key が実在するか（他施設・無関係な顧客のメモを引けないようにする）
async function keyBelongsToFacility(admin: ReturnType<typeof createServiceRoleClient>, facilityId: string, key: string): Promise<boolean> {
  const { data } = await admin.from('bookings').select('email, customer_name').eq('facility_id', facilityId);
  return (data as { email: string | null; customer_name: string | null }[] ?? []).some((b) => bookingKey(b) === key);
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'customer-note-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = (request.nextUrl.searchParams.get('customer_key') || '').toLowerCase();
  if (!key || key.length > 254) return NextResponse.json({ error: 'customer_key が不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  if (!(await keyBelongsToFacility(admin, auth.facilityId, key))) return NextResponse.json({ note: null });

  const { data, error } = await admin
    .from('salon_customer_notes').select('note, tags, next_visit_date, next_visit_note')
    .eq('facility_id', auth.facilityId).eq('customer_key', key).maybeSingle();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ note: data ?? null });
}

export async function PUT(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'customer-note-put')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = (request.nextUrl.searchParams.get('customer_key') || '').toLowerCase();
  if (!key || key.length > 254) return NextResponse.json({ error: 'customer_key が不正です' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  if (!(await keyBelongsToFacility(admin, auth.facilityId, key))) {
    return NextResponse.json({ error: '対象のお客様が見つかりません' }, { status: 400 });
  }

  const row = {
    facility_id: auth.facilityId,
    customer_key: key,
    note: parsed.data.note ?? null,
    tags: parsed.data.tags ?? [],
    next_visit_date: parsed.data.next_visit_date ?? null,
    next_visit_note: parsed.data.next_visit_note ?? null,
    updated_by: auth.userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from('salon_customer_notes').upsert(row, { onConflict: 'facility_id,customer_key' })
    .select('note, tags, next_visit_date, next_visit_note').single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'update', tableName: 'salon_customer_notes', recordId: key, ipAddress: ip });
  return NextResponse.json({ note: data });
}
