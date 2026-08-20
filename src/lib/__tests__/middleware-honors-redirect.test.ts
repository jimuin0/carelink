/**
 * middleware.ts の「認証済みユーザーが /auth/login・/auth/signup にアクセスした場合の
 * リダイレクト」分岐が `?redirect` を尊重すること（P0-4）の検査。
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 従来この分岐は `?redirect` を一切見ず `/mypage` へ固定していたため、
 * `/register/complete` → `/auth/signup?redirect=/admin/onboarding&...` や
 * `Header.tsx` の「店舗ログイン」（`/auth/login?redirect=/admin`）が、
 * 既にログイン済みのユーザーに対しては機能しなかった。
 *
 * safeRedirect（src/lib/safe-redirect.ts）を通すことで:
 *  - 同一オリジンの相対パスは尊重する
 *  - 絶対 URL・プロトコル相対 URL は既定の /mypage へ倒す
 *  - `/\evil.com` のような「旧ガードは通すが実は外部オリジンへ解決される」値も
 *    既定の /mypage へ倒す（このテストの本体・負の対照は下記コメント参照）
 *
 * 手本: src/lib/__tests__/middleware-redirect-cookies.test.ts と同じモック/ハーネス方式。
 */

// ---- fake NextResponse（cookies を実際に保持する）----
function cookieStore() {
  const m = new Map<string, { name: string; value: string; [k: string]: unknown }>();
  return {
    set: (a: unknown, b?: string, c?: object) => {
      if (a && typeof a === 'object') {
        const co = a as { name: string; value: string };
        m.set(co.name, { ...(a as object), name: co.name, value: co.value } as never);
      } else {
        m.set(a as string, { name: a as string, value: b as string, ...(c || {}) });
      }
    },
    getAll: () => [...m.values()],
    get: (k: string) => m.get(k),
  };
}
function makeResponse() {
  return { cookies: cookieStore(), headers: new Headers() } as Record<string, unknown>;
}

let getUserImpl: (opts: { cookies: { setAll: (c: unknown[]) => void } }) => Promise<{ data: { user: unknown } }>;

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => makeResponse(),
    redirect: (url: unknown) => {
      const r = makeResponse();
      r._isRedirect = true;
      r._redirectedTo = url;
      return r;
    },
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[]) => void } }) => ({
    auth: { getUser: () => getUserImpl(opts) },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { middleware } from '../../middleware';
import { buildOnboardingAuthPath } from '../onboarding-link';

function makeNextUrl(pathWithQuery: string): URL & { clone: () => URL } {
  const u = new URL('https://carelink-jp.com' + pathWithQuery) as URL & { clone: () => URL };
  u.clone = () => makeNextUrl(pathWithQuery);
  return u;
}

function makeRequest(pathWithQuery: string, cookies: Record<string, string> = {}) {
  const cm = new Map(Object.entries(cookies).map(([k, v]) => [k, { name: k, value: v }]));
  return {
    nextUrl: makeNextUrl(pathWithQuery),
    headers: new Headers(),
    cookies: {
      get: (k: string) => cm.get(k),
      getAll: () => [...cm.values()],
      set: (k: string, v: string) => cm.set(k, { name: k, value: v }),
    },
  } as never;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.ADMIN_COOKIE_SECRET = 'test-secret';
  // 既定：認証済みユーザー（/admin 権限チェックは本テストの対象外なので facility_members は
  // 空 = owner/admin ではない前提。/auth/login・/auth/signup 分岐は権限チェックの手前で
  // 完結するのでこれには依存しない）。
  getUserImpl = async () => ({ data: { user: { id: 'u1' } } });
});

test('(i) 認証済み + /auth/login?redirect=/admin → /admin へ', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/auth/login?redirect=/admin'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/admin');
});

test('(ii) 認証済み + /auth/login?redirect=https://evil.example.com → /mypage へ', async () => {
  const res: Record<string, unknown> = await middleware(
    makeRequest('/auth/login?redirect=' + encodeURIComponent('https://evil.example.com'))
  );
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
});

test('(iii) 🔴 負の対照: 認証済み + /auth/login?redirect=/\\evil.com → /mypage へ', async () => {
  // '/\evil.com' は旧ガード（raw.startsWith('/') && !raw.startsWith('//')）を素通りしていた値。
  // URL パーサはバックスラッシュを '/' に正規化するため、実際には外部オリジンへ解決される
  // （src/lib/safe-redirect.ts のコメント・src/lib/__tests__/safe-redirect.test.ts 参照）。
  // 修正前のコードへ一時的に戻して本テストを実行し、実際に赤くなる（/mypage ではなく
  // 外部相当のパスへ redirect してしまう）ことを確認済み（報告参照）。
  const raw = '/\\evil.com';
  // このテスト自身が「本当に危険な値か」を主張する（safeRedirect.test.ts と同じ設計）。
  expect(new URL(raw, 'https://carelink-jp.com').origin).not.toBe('https://carelink-jp.com');

  const res: Record<string, unknown> = await middleware(
    makeRequest('/auth/login?redirect=' + encodeURIComponent(raw))
  );
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
});

test('(iv) 認証済み + /auth/login（redirect 無し）→ /mypage へ（既存 AUTH-1 との互換）', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/auth/login'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
});

test('(v) 認証済み + /auth/signup?redirect=/admin/onboarding&facility_name=... → クエリごと保持', async () => {
  const qs = 'redirect=' + encodeURIComponent('/admin/onboarding?facility_name=%E3%83%86%E3%82%B9%E3%83%88');
  const res: Record<string, unknown> = await middleware(makeRequest(`/auth/signup?${qs}`));
  expect(res._isRedirect).toBe(true);
  const dest = res._redirectedTo as URL;
  expect(dest.pathname).toBe('/admin/onboarding');
  expect(dest.searchParams.get('facility_name')).toBe('テスト');
});

/**
 * 🔴 (vi) プロダクトが実際に生成するリンクの形（src/lib/onboarding-link.ts の
 * buildOnboardingAuthPath がそのまま出す URL）を入力にする。
 *
 * 2026年8月20日以前は、店舗化フローのリンク（/register/complete・email.ts の受付/
 * フォローメール）が facility_name/business_type を「redirect の兄弟」クエリ
 * （例: `/auth/signup?redirect=/admin/onboarding&facility_name=…`）として置いていた。
 * このファイルの旧テストはネスト形（redirect の【中】に facility_name を入れた形）
 * しか入力にしておらず、実際にプロダクトが送出していた兄弟クエリ形は一度も
 * この検査を通っていなかった（＝テストは緑のまま実物は落ちていた）。
 *
 * 実際に兄弟クエリ形を本テストのハーネスへ入れて確認したところ、次の結果になった
 * （facility_name が丸ごと消える＝本テストが検出すべきだった不具合の再現）:
 *   入力: /auth/signup?redirect=%2Fadmin%2Fonboarding&facility_name=%E3%83%86%E3%82%B9%E3%83%88
 *   出力: pathname=/admin/onboarding search='' facility_name=null
 *
 * 修正はリンク側（4箇所）を buildOnboardingAuthPath 経由のネスト形へ統一する方針を採った
 * （middleware.ts 自体は変更しない）。このテストは、その関数が実際に出す URL を
 * そのまま入力にして、facility_name/business_type が最後まで保持されることを固定する。
 */
test('(vi) 認証済み + /auth/signup?redirect=... (buildOnboardingAuthPath が実際に生成する形) → facility_name/business_type ごと /admin/onboarding へ', async () => {
  const authPath = buildOnboardingAuthPath('signup', { facilityName: 'テスト整骨院', businessType: '整骨院' });
  // 空振り防止: 生成された値が本当にネスト形（redirect の value 自身に "?" を含む）であることを
  // 確認しておく。兄弟クエリ形（トップレベルに facility_name が並ぶ形）とは構造的に異なる。
  expect(authPath).toContain('redirect=%2Fadmin%2Fonboarding%3Ffacility_name%3D');
  expect(authPath.split('facility_name').length - 1).toBe(1); // トップレベルに重複して出ていない

  const res: Record<string, unknown> = await middleware(makeRequest(authPath));
  expect(res._isRedirect).toBe(true);
  const dest = res._redirectedTo as URL;
  expect(dest.pathname).toBe('/admin/onboarding');
  expect(dest.searchParams.get('facility_name')).toBe('テスト整骨院');
  expect(dest.searchParams.get('business_type')).toBe('整骨院');
});

test('(vii) 🔴 負の対照（現状記録）: 旧・兄弟クエリ形は今も facility_name を落とす（middleware は変更していないため）', async () => {
  // (vi) と対になる負の対照。修正はリンク側の生成形を変えることで解決しており、
  // middleware.ts 自体は意図的に変更していない。そのため「兄弟クエリ形」の入力は
  // 今後も facility_name を失う。これは既知の仕様（新規リンクは全てネスト形で送出される）
  // であり、このテストは将来 middleware だけを直して「直った」と誤解しないよう
  // 現状を機械で記録する。
  const qs = 'redirect=' + encodeURIComponent('/admin/onboarding') + '&facility_name=' + encodeURIComponent('テスト整骨院');
  const res: Record<string, unknown> = await middleware(makeRequest(`/auth/signup?${qs}`));
  expect(res._isRedirect).toBe(true);
  const dest = res._redirectedTo as URL;
  expect(dest.pathname).toBe('/admin/onboarding');
  expect(dest.search).toBe(''); // 兄弟クエリは丸ごと落ちる
  expect(dest.searchParams.get('facility_name')).toBeNull();
});
