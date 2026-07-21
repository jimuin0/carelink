import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';
import { phoneField } from '@/lib/phone';
import { isValidIsoDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

// お名前・電話番号・住所(都道府県)は必須化(2026年7月6日・神原さん指摘)。
// 電話番号はでたらめな値を弾くため、予約フォーム等と同じ phoneField() の書式検証を通す。
const profileSchema = z.object({
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  display_name: z.string().trim().min(1, 'お名前は必須です').max(50),
  phone: phoneField({ required: true }),
  prefecture: z.string().min(1, '都道府県を選択してください').max(20),
  city: z.string().max(50).nullable().optional(),
  // 形式(max(10))だけでは 2026-02-30 等の不在日が通り、DATE 列が拒否して 500 になる
  // （customerSchema.birthday・booking_date と同型の欠陥）。isValidIsoDate は内部で
  // YYYY-MM-DD の形式(10文字固定)まで検証するため、実在日まで検証し明確な 400 で弾く。
  // 空文字/未指定はフォーム未入力の素通し（保存時 null 化）。
  birth_date: z.string()
    .refine((d) => d === '' || isValidIsoDate(d), '生年月日を正しく入力してください')
    .nullable().optional(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).nullable().optional(),
});

// LINE 連携状態を返す（mypage/settings が連携バッジ表示に使用）。
// 旧実装は GET ハンドラが無く settings が GET /api/profile → 405 → 常にエラー表示していた。
// 【監査C2・2026年7月22日】連携の単一ソースは profiles.line_user_id（liff/link が書く唯一の正）。
// 旧実装は line_user_links を user_id で引いて linked を判定していたが、同列は常に NULL のため
// LIFF 連携済みでも常に linked=false（未連携表示）になっていた。profiles.line_user_id の
// 非 NULL で連携判定する（送信経路と単一ソースを一致させる）。
export const GET = withRoute(async (_request, ctx) => {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from('profiles')
    .select('line_user_id')
    .eq('id', ctx.user!.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ linked: !!data?.line_user_id });
}, {
  csrf: false,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 30, windowMs: 60_000, prefix: 'profile-get' },
  sentryTag: 'profile-get',
});

export const PUT = withRoute(async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const d = parsed.data;
  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient
    .from('profiles')
    .update({
      display_name: d.display_name,
      phone: d.phone,
      prefecture: d.prefecture,
      city: d.city ?? null,
      birth_date: d.birth_date ?? null,
      gender: d.gender ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.user!.id);

  if (error) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'profile' },
  sentryTag: 'profile',
});
