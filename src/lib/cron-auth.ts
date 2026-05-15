import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

/**
 * Cron ジョブの認証チェック
 * タイミング攻撃防止のため timingSafeEqual を使用
 * 通過する場合は null を返す（= OK）
 */
export function checkCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
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
