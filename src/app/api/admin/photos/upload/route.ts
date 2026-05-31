import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 5 * 1024 * 1024;

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  return data?.facility_id ?? null;
}

// 画像を service-role で carelink-uploads にアップロードし public URL を返す
// （carelink-uploads の INSERT ポリシーが anon 専用のため、認証管理者はサーバ側で実行）
export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'photos-upload')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
  if (!ALLOWED.includes(file.type as typeof ALLOWED[number])) return NextResponse.json({ error: 'JPG, PNG, WebPのみ対応しています' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'ファイルサイズは5MB以下にしてください' }, { status: 400 });

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `facilities/${facilityId}/${Date.now()}.${ext}`;
  const admin = createServiceRoleClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from('carelink-uploads').upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: '画像のアップロードに失敗しました' }, { status: 500 });

  const { data } = admin.storage.from('carelink-uploads').getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
