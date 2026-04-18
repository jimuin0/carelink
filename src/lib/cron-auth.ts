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
  // Pad to same length to avoid length-based timing leak
  const a = Buffer.from(actual.padEnd(expectedFull.length, '\0'));
  const b = Buffer.from(expectedFull.padEnd(actual.length, '\0'));
  // Use the longer length so both buffers are equal size
  const len = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(len);
  const bBuf = Buffer.alloc(len);
  a.copy(aBuf);
  b.copy(bBuf);
  const valid = timingSafeEqual(aBuf, bBuf);
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
