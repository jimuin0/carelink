import { platformControlResponse } from '@/lib/platform-control-write';
import { readAuthorization } from '@/lib/authorization-read';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';
import type { Database } from '@/types/database.types';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';

// gbp_posts.facility_id は migrations 上 NOT NULL（database.types.ts の Row/Insert/Update いずれも
// facility_id は string で null を許容しない）。PATCH で送る更新差分の型はここから取る。
type GbpPostUpdate = Database['public']['Tables']['gbp_posts']['Update'];

function safeSlice(value:string,length:number){const text=value.slice(0,length);return /[\uD800-\uDBFF]$/.test(text)?text.slice(0,-1):text;}
function invalidText(value:unknown){return typeof value==='string'&&/[\uD800-\uDFFF]/u.test(value);}

async function handleGET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'gbp-posts-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/posts');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: facility_id をクエリから受け取り所属集合で検証する（非決定的なlimit(1)決め打ち排除）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/posts');
  if (facilityIds instanceof NextResponse) return facilityIds;
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

  if (error) return serverError('admin-gbp-posts-list', error, '/api/admin/gbp/posts');
  if(!Array.isArray(data))return serverError('admin-gbp-posts-list',new Error('GBP_LIST_UNCONFIRMED'),'/api/admin/gbp/posts');
  return NextResponse.json({ posts: data });
}

async function handlePOST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'gbp-posts')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/posts');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  if(Object.values(body).some(invalidText))return NextResponse.json({error:'Invalid Unicode text'},{status:400});
  const { title, body: postBody, post_type, photo_url, cta_type, cta_url, scheduled_at, facility_id } = body;

  if([title,photo_url,cta_url].some(value=>value!=null&&!['string','number','boolean'].includes(typeof value))||(scheduled_at!=null&&typeof scheduled_at!=='string'))return NextResponse.json({error:'Invalid fields'},{status:400});
  const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/posts');
  if (facilityIds instanceof NextResponse) return facilityIds;
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  if (typeof postBody!=='string'||!postBody.trim()) return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];

  const { data, error } = await supabase
    .from('gbp_posts')
    .insert({
      facility_id: facilityId,
      title: title ? safeSlice(String(title),200) : null,
      body: safeSlice(String(postBody),1500),
      post_type: VALID_POST_TYPES.includes(post_type) ? post_type : 'STANDARD',
      photo_url: photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null,
      cta_type: VALID_CTA_TYPES.includes(cta_type) ? cta_type : null,
      cta_url: cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null,
      status: scheduled_at ? 'scheduled' : 'draft',
      scheduled_at: scheduled_at || null,
    })
    .select()
    .single();

  if(error?.code==='22007'||error?.code==='22008')return NextResponse.json({error:'Invalid dates'},{status:400});
  if (error) return serverError('admin-gbp-posts-create', error, '/api/admin/gbp/posts');

  if(!data||typeof data.id!=='string'||!UUID_REGEX.test(data.id)||data.facility_id!==facilityId)return serverError('admin-gbp-posts-create-receipt',new Error('GBP_CREATE_UNCONFIRMED'),'/api/admin/gbp/posts');

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

async function handlePATCH(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'gbp-posts-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/posts');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: 非会員は id の有無に関わらず即403にする（元の設計どおり）。
  // PATCH/DELETEはid(投稿)起点のため、投稿が実際に属するfacility_idをDBから引き、
  // それが自分の所属集合に含まれるかを検証する（非決定的なlimit(1)決め打ちでは、複数施設
  // 所有者の場合に自分の別施設の投稿でもWHERE不一致で操作できなくなるバグがあった）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/posts');
  if (facilityIds instanceof NextResponse) return facilityIds;
  if (facilityIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if(body===null||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400});
  if(Object.values(body).some(invalidText))return NextResponse.json({error:'Invalid Unicode text'},{status:400});
  const { id, title, body: postBody, post_type, photo_url, cta_type, cta_url, status, scheduled_at, published_at } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (typeof id!=='string'||!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { data: existingPost, error: existingError } = await readAuthorization(supabase.from('gbp_posts').select('facility_id').eq('id', id).single());
  if(existingError?.code==='PGRST116'&&!existingPost)return NextResponse.json({error:'Not found'},{status:404});
  if(existingError||!existingPost||typeof existingPost.facility_id!=='string'||!UUID_REGEX.test(existingPost.facility_id))return serverError('admin-gbp-posts-scope',databaseDiagnostic(existingError),'/api/admin/gbp/posts');
  if (!facilityIds.includes(existingPost.facility_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const facilityId = existingPost.facility_id;

  const VALID_POST_TYPES = ['STANDARD', 'EVENT', 'OFFER'];
  const VALID_CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
  const VALID_STATUSES = ['draft', 'scheduled', 'published', 'cancelled'];

  // Record<string, unknown> だと Supabase の update() が要求する gbp_posts.Update 型
  // （余剰プロパティ拒否・列ごとの型）と合わず tsc エラーになるため、Database 由来の
  // Update 型で宣言する（実行時の組み立て方は変更なし）。
  if([title,photo_url,cta_url].some(value=>value!=null&&!['string','number','boolean'].includes(typeof value))||[scheduled_at,published_at].some(value=>value!=null&&typeof value!=='string'))return NextResponse.json({error:'Invalid fields'},{status:400});
  const allowed: GbpPostUpdate = { updated_at: new Date().toISOString() };
  if(postBody!==undefined&&typeof postBody!=='string')return NextResponse.json({error:'Invalid text'},{status:400});
  if (title !== undefined) allowed.title = title ? safeSlice(String(title),200) : null;
  if (postBody !== undefined) allowed.body = safeSlice(String(postBody),1500);
  if (post_type !== undefined && VALID_POST_TYPES.includes(post_type)) allowed.post_type = post_type;
  if (photo_url !== undefined) allowed.photo_url = photo_url && /^https:\/\/[^\s]{1,490}$/.test(String(photo_url)) ? String(photo_url) : null;
  if (cta_type !== undefined) allowed.cta_type = VALID_CTA_TYPES.includes(cta_type) ? cta_type : null;
  if (cta_url !== undefined) allowed.cta_url = cta_url && /^https:\/\/[^\s]{1,490}$/.test(String(cta_url)) ? String(cta_url) : null;
  if (status !== undefined && VALID_STATUSES.includes(status)) allowed.status = status;
  if (scheduled_at !== undefined) allowed.scheduled_at = scheduled_at || null;
  if (published_at !== undefined) allowed.published_at = published_at || null;

  // 更新件数(affected rows)を検証せず常に成功を返すと、existingPost 取得後に投稿が削除される
  // TOCTOU で 0件更新でも 200 { ok: true } を偽装する（phantom success）。.select() で更新行を
  // 受け取り、0件なら404を返す（catalog/[id] と同型）。
  const { data: updatedRows, error } = await supabase
    .from('gbp_posts')
    .update(allowed)
    .eq('id', id)
    .eq('facility_id', facilityId)
    .select();

  if(error?.code==='22007'||error?.code==='22008')return NextResponse.json({error:'Invalid dates'},{status:400});
  if (error) return serverError('admin-gbp-posts-patch', error, '/api/admin/gbp/posts');
  if(!Array.isArray(updatedRows))return serverError('admin-gbp-posts-patch-receipt',new Error('GBP_UPDATE_UNCONFIRMED'),'/api/admin/gbp/posts');
  if(updatedRows.length===1&&(updatedRows[0].id!==id.toLowerCase()||updatedRows[0].facility_id!==facilityId)||updatedRows.length>1)return serverError('admin-gbp-posts-patch-receipt',new Error('GBP_UPDATE_MISMATCH'),'/api/admin/gbp/posts');
  if (updatedRows.length === 0) return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 });

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

async function handleDELETE(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'gbp-posts-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-facility-auth', '/api/admin/gbp/posts');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: 非会員は id の有無に関わらず即403にする（元の設計どおり）。
  const facilityIds = await getAdminFacilityIds(supabase, user.id, '/api/admin/gbp/posts');
  if (facilityIds instanceof NextResponse) return facilityIds;
  if (facilityIds.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (typeof id!=='string'||!UUID_REGEX.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // 監査A2: PATCHと同様、投稿の実所属施設をDBから検証する。
  const { data: existingPost, error: existingError } = await readAuthorization(supabase.from('gbp_posts').select('facility_id').eq('id', id).single());
  if(existingError?.code==='PGRST116'&&!existingPost)return NextResponse.json({error:'Not found'},{status:404});
  if(existingError||!existingPost||typeof existingPost.facility_id!=='string'||!UUID_REGEX.test(existingPost.facility_id))return serverError('admin-gbp-posts-scope',databaseDiagnostic(existingError),'/api/admin/gbp/posts');
  if (!facilityIds.includes(existingPost.facility_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const facilityId = existingPost.facility_id;

  // PATCHと同様、TOCTOU による 0件削除の phantom success を防ぐ（catalog/[id] と同型）。
  const { data: deletedRows, error } = await supabase
    .from('gbp_posts')
    .delete()
    .eq('id', id)
    .eq('facility_id', facilityId)
    .select();

  if (error) return serverError('admin-gbp-posts-delete', error, '/api/admin/gbp/posts');
  if(!Array.isArray(deletedRows))return serverError('admin-gbp-posts-delete-receipt',new Error('GBP_DELETE_UNCONFIRMED'),'/api/admin/gbp/posts');
  if(deletedRows.length===1&&(deletedRows[0].id!==id.toLowerCase()||deletedRows[0].facility_id!==facilityId)||deletedRows.length>1)return serverError('admin-gbp-posts-delete-receipt',new Error('GBP_DELETE_MISMATCH'),'/api/admin/gbp/posts');
  if (deletedRows.length === 0) return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 });

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

export async function GET(req:NextRequest){return platformControlResponse(()=>handleGET(req),'/api/admin/gbp/posts');}

export async function POST(req:NextRequest){return platformControlResponse(()=>handlePOST(req),'/api/admin/gbp/posts');}

export async function PATCH(req:NextRequest){return platformControlResponse(()=>handlePATCH(req),'/api/admin/gbp/posts');}

export async function DELETE(req:NextRequest){return platformControlResponse(()=>handleDELETE(req),'/api/admin/gbp/posts');}
