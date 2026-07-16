/**
 * キャンセル待ち登録 API（v8.34）
 * POST /api/waitlist - ウェイトリスト登録
 * DELETE /api/waitlist?id=xxx - キャンセル
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

export const dynamic = 'force-dynamic';

const WaitlistSchema = z.object({
  facility_id:   z.string().uuid(),
  menu_id:       z.string().uuid().optional(),
  staff_id:      z.string().uuid().optional(),
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time:    z.string().regex(/^\d{2}:\d{2}$/),
  end_time:      z.string().regex(/^\d{2}:\d{2}$/),
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  customer_name: z.string().trim().min(1).max(50),
  email:         z.string().email().optional(),
  phone:         z.string().optional(),
  notes:         z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 5, 60_000, 'waitlist')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = WaitlistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
    }

    const cookieStore = await cookies();
    // 認証判定のみ anon SSR クライアント（cookie からセッション解決）。
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );
    // DB 書き込み・参照は service_role に集約（anon INSERT ポリシー削除後も継続動作）。
    // anon キー直書き込み（guest 偽装スパム）を物理的に不能化するための恒久対策。
    const supabase = createServiceRoleClient();

    const { data: { user } } = await authClient.auth.getUser();
    const data = parsed.data;

    // 同じ施設・日時・ユーザーの重複登録を防止
    if (user) {
      const { data: existing } = await supabase
        .from('booking_waitlist')
        .select('id')
        .eq('facility_id', data.facility_id)
        .eq('date', data.date)
        .eq('start_time', data.start_time)
        .eq('user_id', user.id)
        .eq('status', 'waiting')
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ error: 'この日時はすでにキャンセル待ちに登録済みです' }, { status: 409 });
      }
    }

    // 施設の存在確認
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('id, name')
      .eq('id', data.facility_id)
      .eq('status', 'published')
      .maybeSingle();

    if (!facility) {
      return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
    }

    const { data: entry, error } = await supabase
      .from('booking_waitlist')
      .insert({
        ...data,
        user_id: user?.id ?? null,
        // 通知から48時間で期限切れ（まだ未通知なので expires_at は null）
      })
      .select('id')
      .single();

    if (error || !entry) {
      return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      id: entry.id,
      message: `${data.date}（${data.start_time}〜）のキャンセル待ちに登録しました。空きが出た場合にご連絡します。`,
    });
  } catch (e) {
    safeCaptureException(e, 'waitlist-post');
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('waitlist-post', e, '/api/waitlist');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 10, 60_000, 'waitlist-delete')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    // .select() で更新行を取得し、0 行（他人の id・存在しない id）を 404 で返す。付けないと
    // RLS と eq フィルタで 0 行更新でも error=null となり、誤って success:true を返す
    // （ユーザーが「キャンセルできた」と誤認する無音バグ）。
    const { data: updated, error } = await supabase
      .from('booking_waitlist')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id');

    if (error) return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'キャンセル待ちが見つかりません' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'waitlist-delete');
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('waitlist-delete', e, '/api/waitlist');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
