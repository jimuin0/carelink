import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { serverError } from '@/lib/with-route';

/**
 * Cron ジョブの認証チェック
 * タイミング攻撃防止のため timingSafeEqual を使用
 * 通過する場合は null を返す（= OK）
 *
 * 🔴 CRON_SECRET 未設定は【全 cron が 500 で死ぬ】最悪の設定事故なので、必ず通知に載せる。
 *   cron の route は withRoute を使わず `return checkCronAuth(...)` の戻り値をそのまま返すため、
 *   withRoute の「res.status >= 500 なら alertCaughtError」経路には乗らない。素の
 *   NextResponse.json(..., 500) を返していた頃は、15本すべてが無音で 500 を返し続けた
 *   （認証は logCronRun より前に走るので cron_logs にも 1 行も残らない）。
 *   serverError() を通すことで safeCaptureException ＋ alertCaughtError（Slack）へ載せる。
 *   応答 body は従来と同一（`{ error: 'Server misconfiguration' }`）で、監視や dispatcher が
 *   読んでいる形は変えない。
 *
 * ⚠️ 401（シークレット不一致・未提示）は意図的に通知しない。/api/cron/* は誰でも叩けるので、
 *   401 を通知に載せると外部からいくらでも Slack を鳴らせる（通知経路そのものが攻撃面になる）。
 *   シークレット不一致で cron が丸ごと止まる事故は、cron-heartbeat の鮮度を見る
 *   /api/health（degraded → health-monitor）が検知する側に残す。
 */
export function checkCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return serverError(
      'cron-auth-missing-secret',
      new Error('CRON_SECRET is not set — all cron endpoints return 500'),
      // 第2引数の base があるので相対 URL でも throw しない（分岐を増やさずに全域で定義される）。
      new URL(request.url, 'http://cron.invalid').pathname,
      'Server misconfiguration',
    );
  }
  const expectedFull = `Bearer ${expected}`;
  const actual = authHeader ?? '';
  // UTF-8 バイト列で比較（ASCII 以外の文字でも正確に一致判定できる）
  const aBytes = Buffer.from(actual, 'utf8');
  const bBytes = Buffer.from(expectedFull, 'utf8');
  // 長さが異なる場合: パディングして timingSafeEqual を通すが結果は必ず false にする
  // （パディング後の比較だけでは長さ不一致を正しく弾けない場合があるため二重チェック）
  const len = Math.max(aBytes.length, bBytes.length);
  const aBuf = Buffer.alloc(len);
  const bBuf = Buffer.alloc(len);
  aBytes.copy(aBuf);
  bBytes.copy(bBuf);
  // timingSafeEqual は定数時間比較。長さ不一致は別途チェックして必ず false を返す
  const valid = timingSafeEqual(aBuf, bBuf) && aBytes.length === bBytes.length;
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
