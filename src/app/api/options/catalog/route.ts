import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError } from '@/lib/with-route';
import { isPaymentsEnabled } from '@/lib/integration-availability';

export const dynamic = 'force-dynamic';

/**
 * 施設の管理画面に出す「有料オプション一覧」。
 *
 * 【2026年7月30日 新設・買えない商品を並べていた問題の根治】
 * 従来は管理画面のクライアントが option_catalog を直接読み、is_active=true の4件
 * （reminder_email_3d ¥500 ／ reminder_line ¥1,500 ／ time_adjust_line ¥500 ／
 * hpb_integration ¥3,000）を値札と購入ボタン付きで並べていた。しかし本番に
 * STRIPE_SECRET_KEY は存在せず、購入ボタンを押すと /api/options/checkout が
 * 503「決済機能が設定されていません」を返す（実測で確認）。
 * 施設に値段を見せて押させ、エラーを返す状態だった。金銭が絡むぶん実害が大きい。
 *
 * 【なぜサーバで判定するか＝真の予防】
 * 購入可否を決めるのはサーバの STRIPE_SECRET_KEY であり、クライアントからは見えない。
 * 表示側で個別に隠す運用にすると必ずズレる（隠し忘れ・戻し忘れ）。
 * 決済セッションを作る checkout と同じ変数をここで見て、購入できないものは
 * そもそも返さない。神原さんが鍵を入れた瞬間に全オプションが自動で復活する。
 *
 * 【contact_only は残す】
 * HPB 連携のような contact_only オプションは決済を通さず /api/options/inquiry から
 * Slack へ申込みが飛ぶ運用で、決済が無くても成立する（SLACK_BOT_TOKEN は設定済み）。
 * 決済未設定でも使えるため、こちらは隠さない。
 *
 * 読み取りのみ・副作用なし。anon クライアントで RLS 越しに公開カタログを読む。
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 30, 60_000, 'options-catalog')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from('option_catalog')
      .select('key, name, description, monthly_price, contact_only, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    // 取得失敗を空配列に化けさせない。空で返すと「オプションが1つも無い」と
    // 見分けがつかず、障害が無音になる（availability / slots と同じ方針）。
    if (error) {
      return serverError('options-catalog', error, '/api/options/catalog');
    }

    const rows = (data ?? []) as { contact_only: boolean }[];
    const paymentsEnabled = isPaymentsEnabled();
    // 決済が無い間は「購入が必要なオプション」を一切返さない。申込み制のみ残す。
    const options = paymentsEnabled ? rows : rows.filter((o) => o.contact_only);

    return NextResponse.json({ paymentsEnabled, options });
  } catch (e) {
    return serverError('options-catalog', e, '/api/options/catalog');
  }
}
