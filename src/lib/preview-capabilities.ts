/** Missing private capabilities are intentional in public read-only previews.
 * Production must continue to fail closed when its required secrets are absent.
 */
export function isPublicReadOnlyPreview(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The public Preview carries only the production public URL/anon key. Signing in
// there would act on real production accounts, and a session is what every
// write policy keys on. Keep these areas closed so Preview stays read-only.
const ACCOUNT_PATHS = ['/auth', '/mypage', '/admin', '/liff', '/api/auth'];

export const PREVIEW_READ_ONLY_MESSAGE =
  'このプレビュー環境では、ログイン・会員機能・書き込みは使えません（本番のデータを守るため）。公開ページの閲覧だけを確認できます。';

/** True when a public read-only Preview must refuse this request. */
export function isPreviewRestricted(method: string, pathname: string): boolean {
  if (!isPublicReadOnlyPreview()) return false;
  if (!SAFE_METHODS.has(method.toUpperCase())) return true;
  return ACCOUNT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Fixed, cache-free refusal. Pages get a short notice, other methods JSON. */
export function previewRestrictedResponse(method: string): Response {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    return Response.json({ error: PREVIEW_READ_ONLY_MESSAGE, code: 'preview_read_only' }, { status: 403, headers });
  }
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>プレビュー環境</title></head>'
    + `<body><main><h1>プレビュー環境</h1><p>${PREVIEW_READ_ONLY_MESSAGE}</p><p><a href="/">トップへ戻る</a></p></main></body></html>`;
  return new Response(html, { status: 403, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
