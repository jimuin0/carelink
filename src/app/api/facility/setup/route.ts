import { NextRequest, NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { SALON_CLAIM_COOKIE_NAME, verifySalonClaimDetails } from '@/lib/salon-claim';
import { isSalonIntentProof, salonIntentCookieName } from '@/lib/salon-submission-proof';
import { facilitySetupInput, setupFacilityAtomically, type FacilitySetupClaim } from '@/lib/facility-setup-atomic';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

/** A verified browser capability selects exactly one receipt. The service-only
 * transaction authorizes its claim again under lock and commits all writes.
 * No unverified email fallback or best-effort ownership/photograph writes. */
export const POST = withRoute(async (request, ctx) => {
  const parsed = facilitySetupInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'INVALID_INPUT', error: '入力項目と許認可・届出への同意を確認してください。' }, { status: 400, headers });
  const cookies = new NextRequest(request.url, { headers: request.headers }).cookies;
  let claim: FacilitySetupClaim = { mode: 'none' };
  if (parsed.data.intentId !== undefined) {
    const proof = cookies.get(salonIntentCookieName(parsed.data.intentId)!)?.value;
    if (!isSalonIntentProof(proof)) return NextResponse.json({ code: 'HANDOFF_UNVERIFIED', error: '申込を確認できません。申し込みに使用したブラウザーで受付状況を確認してください。' }, { status: 403, headers });
    claim = { mode: 'intent', intentId: parsed.data.intentId, proof };
  } else {
    const cookie = cookies.get(SALON_CLAIM_COOKIE_NAME);
    if (cookie !== undefined) {
      const legacy = verifySalonClaimDetails(cookie.value);
      if (!legacy) return NextResponse.json({ code: 'HANDOFF_UNVERIFIED', error: '申込の引き継ぎ期限または確認情報を確認できません。新たに送信せず、お問い合わせください。' }, { status: 403, headers });
      claim = { mode: 'legacy', ...legacy };
    }
  }
  const result = await setupFacilityAtomically(createServiceRoleClient(), ctx.user!.id, parsed.data, claim);
  if (result.state === 'unknown') return NextResponse.json({ code: 'SETUP_RESULT_UNKNOWN', error: '作成結果を確認できていません。申込を新しく送信せず、この画面から同じ内容で確認してください。' }, { status: 202, headers });
  if (result.state === 'invalid') return NextResponse.json({ code: 'INVALID_INPUT', error: '施設名・業種などの入力内容を確認してください。' }, { status: 400, headers });
  if (result.state === 'unverified') return NextResponse.json({ code: 'HANDOFF_UNVERIFIED', error: '引き継ぎ対象の申込を確認できません。新たに送信せず、お問い合わせください。' }, { status: 403, headers });
  if (result.state === 'conflict') return NextResponse.json({ code: 'HANDOFF_CONFLICT', error: 'この申込は取り込み済み、または確認が必要な状態です。別の施設として再作成せず、お問い合わせください。' }, { status: 409, headers });
  if (result.state === 'already_member' && claim.mode !== 'none') return NextResponse.json({
    code: 'ALREADY_MEMBER', facilityId: result.facilityId,
    error: '既に管理対象の施設があります。今回の申込は取り込んでいません。別店舗の管理についてお問い合わせください。',
  }, { status: 409, headers });
  // Preserve the capability for a lost HTTP response/replay; the DB tombstone
  // prevents a different user from consuming it. Clearing it here would make
  // the exact result unresolvable after a disconnect.
  return NextResponse.json({ success: true, state: result.state, facilityId: result.facilityId,
    slug: result.slug, message: result.state === 'created' ? '店舗アカウントを作成しました。公開には管理画面の設定が必要です。' : '登録済みの店舗アカウントを確認しました。',
  }, { status: result.state === 'created' ? 201 : 200, headers });
}, { csrf: true, requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'facility-setup' },
  sentryTag: 'facility-setup',
});
