import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
/**
 * 個別対応オプション（contact_only: HPB 連携など）の申込み受付
 * POST /api/options/inquiry  body: { facilityId, optionKey }
 *
 * 自動課金せず、Slack へ申込み通知を送る（プラットフォーム側で個別見積り・契約後に
 * facility_entitlements を有効化する運用）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { postToSlack } from '@/lib/slack';

export const dynamic = 'force-dynamic';

const OPTION_KEY_REGEX = /^[a-z0-9_]{1,64}$/;

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'mutation')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { facilityId, optionKey } = await request.json().catch(() => ({}));
    if (!facilityId || !UUID_REGEX.test(facilityId) || !optionKey || !OPTION_KEY_REGEX.test(optionKey)) {
      return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
    }

    // 施設の owner/admin のみ申込み可能
    const { data: membership } = await supabase
      .from('facility_members')
      .select('role')
      .eq('facility_id', facilityId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: 'この施設の管理権限がありません' }, { status: 403 });
    }

    // contact_only のオプションのみ受け付ける
    const { data: option } = await supabase
      .from('option_catalog')
      .select('key, name, contact_only, is_active')
      .eq('key', optionKey)
      .maybeSingle();
    if (!option || !option.is_active || !option.contact_only) {
      return NextResponse.json({ error: 'このオプションは申込み対象ではありません' }, { status: 400 });
    }

    // 施設名（通知用・失敗しても申込み自体は受け付ける）
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name')
      .eq('id', facilityId)
      .maybeSingle();

    const result = await postToSlack({
      text: [
        '📩 有料オプション申込み（個別対応）',
        `オプション: ${option.name}（${option.key}）`,
        `施設: ${facility?.name ?? '(名称取得失敗)'} (${facilityId})`,
        `申込みユーザー: ${user.id}`,
        '対応: 個別見積り → 契約後に facility_entitlements を有効化してください。',
      ].join('\n'),
    });

    if (!result.ok) {
      // 通知が届かないと申込みが闇に消えるため、ユーザーには失敗として返す（silent 防止）
      console.error('[options/inquiry] Slack notify failed', { error: result.error });
      return NextResponse.json({ error: '申込みの送信に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[options/inquiry] Error:', e);
    return NextResponse.json({ error: '申込みの送信に失敗しました' }, { status: 500 });
  }
}
