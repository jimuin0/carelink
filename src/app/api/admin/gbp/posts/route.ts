import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'gbp-posts-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: facility_id をクエリから受け取り所属集合で検証する（非決定的なlimit(1)決め打ち排除）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id);
  const requested = req.nextUrl.searchParams.get('facility_id');
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, requested);
  if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  const { data, error } = await supabase
    .from('gbp_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'gbp-posts')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { title, body: postBody, post_type, photo_url, cta_type, cta_url, scheduled_at, facility_id } = body;

  const facilityIds = await getAdminFacilityIds(supabase, user.id);
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  if (!postBody?.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];

  const { data, error } = await supabase
    .from('gbp_posts')
    .insert({
      facility_id: facilityId,
      title: title ? String(title).slice(0, 200) : null,
      body: String(postBody).slice(0, 1500),
      post_type: VALID_POST_TYPES.includes(post_type) ? post_type : 'STANDARD',
      photo_url: photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null,
      cta_type: VALID_CTA_TYPES.includes(cta_type) ? cta_type : null,
      cta_url: cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null,
      status: scheduled_at ? 'scheduled' : 'draft',
      scheduled_at: scheduled_at || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'create',
    tableName: 'gbp_posts',
    recordId: data.id,
    newValues: { post_type: data.post_type, status: data.status },
    ipAddress: ip,
  });

  return NextResponse.json({ post: data });
}

export async function PATCH(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'gbp-posts-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: 非会員は id の有無に関わらず即403にする（元の設計どおり）。
  // PATCH/DELETEはid(投稿)起点のため、投稿が実際に属するfacility_idをDBから引き、
  // それが自分の所属集合に含まれるかを検証する（非決定的なlimit(1)決め打ちでは、複数施設
  // 所有者の場合に自分の別施設の投稿でもWHERE不一致で操作できなくなるバグがあった）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id);
  if (facilityIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { id, title, body: postBody, post_type, photo_url, cta_type, cta_url, status, scheduled_at, published_at } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { data: existingPost } = await supabase.from('gbp_posts').select('facility_id').eq('id', id).single();
  if (!existingPost) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!facilityIds.includes(existingPost.facility_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const facilityId = existingPost.facility_id;

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
  const VALID_STATUSES = ['draft', 'scheduled', 'published', 'cancelled'];

  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) allowed.title = title ? String(title).slice(0, 200) : null;
  if (postBody !== undefined) allowed.body = String(postBody).slice(0, 1500);
  if (post_type !== undefined && VALID_POST_TYPES.includes(post_type)) allowed.post_type = post_type;
  if (photo_url !== undefined) allowed.photo_url = photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null;
  if (cta_type !== undefined) allowed.cta_type = VALID_CTA_TYPES.includes(cta_type) ? cta_type : null;
  if (cta_url !== undefined) allowed.cta_url = cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null;
  if (status !== undefined && VALID_STATUSES.includes(status)) allowed.status = status;
  if (scheduled_at !== undefined) allowed.scheduled_at = scheduled_at || null;
  if (published_at !== undefined) allowed.published_at = published_at || null;

  const { error } = await supabase
    .from('gbp_posts')
    .update(allowed)
    .eq('id', id)
    .eq('facility_id', facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'gbp_posts',
    recordId: id,
    newValues: allowed,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'gbp-posts-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: 非会員は id の有無に関わらず即403にする（元の設計どおり）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id);
  if (facilityIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // 監査A2: PATCHと同様、投稿の実所属施設をDBから検証する。
  const { data: existingPost } = await supabase.from('gbp_posts').select('facility_id').eq('id', id).single();
  if (!existingPost) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!facilityIds.includes(existingPost.facility_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const facilityId = existingPost.facility_id;

  // 削除件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（直前の存在確認後に
  // 別リクエストで削除される等）による0件削除も「成功」と偽装していた（phantom success）。
  // .select() で削除行を受け取り、0件なら404を返す（catalog/[id]等と同型）。
  const { data, error } = await supabase
    .from('gbp_posts')
    .delete()
    .eq('id', id)
    .eq('facility_id', facilityId)
    .select();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'delete',
    tableName: 'gbp_posts',
    recordId: id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}
