/**
 * POST /api/preferred-staff — 指名スタッフの登録・解除（2026年10月22日 新設）
 *
 * マイページの「指名スタッフ」は「施設のスタッフページから指名登録できます」と案内していたが、
 * 登録するボタンも経路もどこにも無く、タブは誰にとっても空のままだった。
 *
 * ブラウザから user_preferred_staff へ直接書かせず、ここを通すのは、RLS（user_id = auth.uid()）が
 * 「自分の行か」しか見ないため。直接 INSERT では、非表示（is_active=false）のスタッフや
 * 非公開施設のスタッフまで指名できてしまう。登録時だけ、公開施設の在籍スタッフであることを確かめる。
 * 解除はいつでもできる（スタッフが非表示になった後でも、自分のリストから外せるように）。
 *
 * 書き込みはログイン本人の SSR クライアントで行う（service role は使わない＝RLS が最後の砦として残る）。
 * 二重登録は UNIQUE(user_id, staff_id) が止めるので、23505 は「登録済み」として成功扱いにする。
 */
import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/preferred-staff';
const TAG = 'preferred-staff';
const NO_STORE = { 'Cache-Control': 'no-store' };

export const POST = withRoute(async (request, ctx) => {
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'スタッフの指定が正しくありません' }, { status: 400 });
  }
  const { staffId, nominated } = body as Record<string, unknown>;
  if (typeof staffId !== 'string' || !UUID_REGEX.test(staffId)) {
    return NextResponse.json({ error: 'スタッフの指定が正しくありません' }, { status: 400 });
  }
  if (typeof nominated !== 'boolean') {
    return NextResponse.json({ error: '指名の状態が正しくありません' }, { status: 400 });
  }

  const supabase = ctx.supabase!;
  const userId = ctx.user!.id;

  if (!nominated) {
    const { error } = await supabase
      .from('user_preferred_staff')
      .delete()
      .eq('user_id', userId)
      .eq('staff_id', staffId);
    if (error) return serverError(TAG, error, ROUTE, '指名を解除できませんでした。時間をおいて再度お試しください。');
    return NextResponse.json({ nominated: false }, { headers: NO_STORE });
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff_profiles')
    .select('id, facility_id')
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle();
  if (staffError) return serverError(TAG, staffError, ROUTE, '指名登録できませんでした。時間をおいて再度お試しください。');

  const { data: facility, error: facilityError } = staff
    ? await supabase
      .from('facility_profiles')
      .select('id')
      .eq('id', staff.facility_id)
      .eq('status', 'published')
      .maybeSingle()
    : { data: null, error: null };
  if (facilityError) return serverError(TAG, facilityError, ROUTE, '指名登録できませんでした。時間をおいて再度お試しください。');
  if (!staff || !facility) {
    return NextResponse.json({ error: 'このスタッフは現在指名登録できません' }, { status: 404 });
  }

  const { error: insertError } = await supabase
    .from('user_preferred_staff')
    .insert({ user_id: userId, staff_id: staffId });
  if (insertError && insertError.code !== '23505') {
    return serverError(TAG, insertError, ROUTE, '指名登録できませんでした。時間をおいて再度お試しください。');
  }
  return NextResponse.json({ nominated: true }, { headers: NO_STORE });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 20, windowMs: 60_000, prefix: 'preferred-staff' },
  sentryTag: TAG,
});
