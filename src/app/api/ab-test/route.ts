import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { z } from 'zod';

// 【2026年7月16日 恒久根治】metadata に上限が無く、匿名POSTから任意サイズ・任意キー数の
// オブジェクトを service role でそのまま ab_test_events.metadata（jsonb）へ書き込んでいた
// （intake/route.ts の responses と同型の欠陥・巨大ペイロードでの DB 圧迫や将来の集計処理の
// 破綻を招きうる）。intake の responses 50000字上限と同水準の防御として、キー数上限と
// JSON文字列化サイズ上限を追加する（intake と異なりこの経路は元々「不正入力はサイレント無視
// (ok:true)」の設計のため、上限超過時も既存の schema.safeParse 失敗パスに合流させ挙動を変えない）。
const AB_TEST_METADATA_MAX_KEYS = 20;
const AB_TEST_METADATA_MAX_JSON_LENGTH = 50_000;

const metadataSchema = z.record(z.string(), z.unknown())
  .refine((m) => Object.keys(m).length <= AB_TEST_METADATA_MAX_KEYS, `metadataは${AB_TEST_METADATA_MAX_KEYS}キー以内で指定してください`)
  .refine((m) => JSON.stringify(m).length <= AB_TEST_METADATA_MAX_JSON_LENGTH, `metadataのサイズが上限（${AB_TEST_METADATA_MAX_JSON_LENGTH}文字）を超えています`)
  .optional();

const schema = z.object({
  experiment_key: z.string().min(1).max(100),
  variant: z.enum(['control', 'treatment']),
  event_type: z.enum(['impression', 'conversion', 'click', 'booking']),
  // user_id は受け付けない — セッションから取得してIDOR/なりすましを防止
  session_id: z.string().max(100).optional(),
  page_path: z.string().max(500).optional(),
  metadata: metadataSchema,
});

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 100, 60_000, 'ab-test')) {
      return NextResponse.json({ ok: true }); // サイレント無視
    }

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: true }); // サイレント無視（metadata上限超過もここに合流）

    // user_id はセッションから取得（リクエストボディの値は使わない）
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();

    const admin = createServiceRoleClient();

    await admin.from('ab_test_events').insert({
      experiment_key: parsed.data.experiment_key,
      variant: parsed.data.variant,
      event_type: parsed.data.event_type,
      user_id: user?.id ?? null,
      session_id: parsed.data.session_id ?? null,
      page_path: parsed.data.page_path ?? null,
      metadata: parsed.data.metadata ?? {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    safeCaptureException(e, 'ab-test-post');
    alertCaughtError('ab-test-post', e, '/api/ab-test');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

// A/Bテスト結果の取得（プラットフォーム管理者専用）
export async function GET(request: NextRequest) {
  try {
    const getIp = getClientIp(request);
    if (await checkRateLimit(null, getIp, 20, 60_000, 'ab-test-get')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('is_platform_admin').eq('id', user.id).single();
    if (!profile?.is_platform_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const key = request.nextUrl.searchParams.get('key');
    if (!key || key.length > 100) return NextResponse.json({ error: 'key required' }, { status: 400 });

    const admin = createServiceRoleClient();

    const { data } = await admin
      .from('ab_test_events')
      .select('variant, event_type')
      .eq('experiment_key', key);

    if (!data) return NextResponse.json({ results: null });

    const stats: Record<string, Record<string, number>> = { control: {}, treatment: {} };
    for (const event of data) {
      const v = stats[event.variant];
      if (v) v[event.event_type] = (v[event.event_type] ?? 0) + 1;
    }

    // コンバージョン率計算
    const getRate = (variant: 'control' | 'treatment') => {
      const impressions = stats[variant].impression ?? 0;
      const conversions = stats[variant].conversion ?? 0;
      return impressions > 0 ? Math.round((conversions / impressions) * 1000) / 10 : 0;
    };

    return NextResponse.json({
      experiment_key: key,
      control: { ...stats.control, conversion_rate: getRate('control') },
      treatment: { ...stats.treatment, conversion_rate: getRate('treatment') },
      lift: getRate('treatment') - getRate('control'),
    });
  } catch (e) {
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    safeCaptureException(e, 'ab-test-get');
    alertCaughtError('ab-test-get', e, '/api/ab-test');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
