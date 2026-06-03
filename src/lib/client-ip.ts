/**
 * クライアント IP 取得ヘルパー（スプーフィング耐性版）。
 *
 * rate-limit.ts から分離した純粋関数。テストで '@/lib/rate-limit' を
 * モックしても本ヘルパーがモック汚染を受けないよう、独立モジュールに置く。
 *
 * 攻撃者はクライアント由来の `x-forwarded-for`(XFF) を任意に詐称できるため、
 * その「先頭値」をレート制限キーに使うと XFF を毎回変えるだけでスロットルを
 * 回避されてしまう。これを防ぐため:
 *   1. 信頼できるプラットフォーム(Vercel 等)が付与する `x-real-ip` を最優先
 *   2. 無ければ `x-forwarded-for` の「末尾」要素を採用する。
 *      XFF は `client, proxy1, proxy2, ...` の順で連結され、最も外側
 *      （= 信頼できる最終プロキシが付与した値）が末尾になるため、
 *      クライアントが詐称できる先頭値ではなく末尾を信頼する。
 *   3. いずれも無ければ 'unknown'
 *
 * @returns 正規化済み（trim 済み）の IP 文字列。取得不能時は 'unknown'
 */
export function getClientIp(request: Request | { headers: Headers }): string {
  const headers = request.headers;

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return 'unknown';
}
