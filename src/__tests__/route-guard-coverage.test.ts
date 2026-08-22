/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * withRoute が束ねている残り3つ（CSRF 検証・レート制限・本人確認）を機械強制する
 * （2026年8月22日 新設）
 *
 * 【なぜ要るか】`no-silent-500` が塞いだのは「500 の通知」だけで、withRoute のもう3つの
 * 責務は 132 本中 121 本でバラバラに実装されたままだった。実装そのものは揃っていて、
 * 実測（2026年8月22日・main = 819246a）でも穴は 1 つも無かった。残っていたのは
 * 【書き忘れても誰も気づかない】という構造のほうで、これは次に足される route.ts に効く。
 *
 * 規約（コメントや PR レビュー）で守らせようとすると、守られたかどうかを人が見ることになる。
 * そこは必ず抜けるので、`no-silent-500` と同じく機械が見る。
 *
 * 【検査するもの】変更系メソッド（POST / PUT / PATCH / DELETE）を持つ route.ts は
 *   1. CSRF 検証を通ること（`checkCsrf` を直接呼ぶ、`csrf: true` を明示する、または
 *      オプション既定の `withRoute`。`csrf: false` しか書かれていないファイルは不合格）
 *   2. レート制限を通ること（`checkRateLimit` または withRoute の `rateLimit:` オプション）
 *   3. 呼び出し元を identify する経路を持つこと（ログイン・cron シークレット・
 *      LIFF・外部サービスの署名検証・API キーのいずれか）
 *
 * 【例外の書き方】ALLOW に理由つきで登録する。理由が空文字なら不合格
 * （`scripts/schema-drift-allow.txt` と同じ「理由必須」の作法）。
 * ALLOW に書いたのに実在しないパスも不合格＝ルートを消したのに免除だけ残る状態を作らない。
 *
 * 【空振り防止】走査対象が十分あることを下限で確かめ、検出関数そのものを合成コードで
 * 検査する負の対照を併設する（判定が壊れて「全部合格」に見える状態を緑にしない）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const API_ROOT = join(ROOT, 'src/app/api');

type Exemption = { csrf?: string; rateLimit?: string; auth?: string };

/**
 * 免除台帳。キーは src/app/api からの相対パス（POSIX 区切り）。
 * 値は免除する観点ごとの【理由】。理由なしの免除は書けない。
 */
const ALLOW: Record<string, Exemption> = {
  '[...notfound]/route.ts': {
    csrf: '未マッチな /api/* に 404 JSON を返すだけの catch-all。副作用も入力の読み取りも無い',
    rateLimit: '同上。DB も外部サービスも触らず、定数の 404 を返すだけ',
    auth: '同上。誰が呼んでも 404 しか返らない',
  },
  'booking/[id]/cancel-fee/route.ts': {
    csrf: '料金ポリシー未確定のため機能ごと無効化中のスタブ。常に 404 を返すだけ',
    rateLimit: '同上。処理本体が存在しない',
    auth: '同上。再有効化するときは本 ALLOW ごと消して3点を実装すること',
  },
  'line/webhook/route.ts': {
    csrf: 'LINE プラットフォームからのサーバ間 POST。ブラウザ発ではないので CSRF は成立せず、'
      + 'x-line-signature の HMAC 検証（verifyLineSignature）が本人性の根拠',
    rateLimit: '送信元は LINE のみで、署名不一致は本体処理の前に落ちる',
  },
  'payment/webhook/route.ts': {
    csrf: 'Stripe からのサーバ間 POST。stripe.webhooks.constructEvent の署名検証が本人性の根拠',
    rateLimit: '同上。署名不一致は本体処理の前に 400 で落ちる',
  },
  'slack/interactions/route.ts': {
    csrf: 'Slack からのサーバ間 POST。verifySlackRequest（署名＋タイムスタンプ）が本人性の根拠',
    rateLimit: '同上。署名不一致は本体処理の前に落ちる',
  },
  'stripe/webhook/route.ts': {
    csrf: 'Stripe からのサーバ間 POST。constructEvent の署名検証が本人性の根拠',
    rateLimit: '同上。署名不一致は本体処理の前に 400 で落ちる',
  },
  'contact/route.ts': {
    auth: '未ログインで送れることが要件の問い合わせフォーム。CSRF＋レート制限＋reCAPTCHA で守る',
  },
  'inquiry/route.ts': {
    auth: '未ログインで送れることが要件の施設への問い合わせ。CSRF＋レート制限で守る',
  },
  'salons/route.ts': {
    auth: '掲載申込フォーム。申込の時点ではまだアカウントが無いので認証を要求できない',
  },
  'unsubscribe/route.ts': {
    auth: 'メール内リンクからの配信停止。HMAC 署名つきトークンが本人性の根拠でログインは要求しない',
  },
  'chat/route.ts': {
    auth: '未ログインの来訪者が使える公式 AI アシスタント。CSRF＋IP レート制限（5回/分）で守る。'
      + '⚠️ 兄弟の symptoms/suggest と違い reCAPTCHA を通していない＝Anthropic の課金を'
      + '外部から焚ける面が残る（UI 側でトークンを送る改修とセットでないと本番が壊れるため別PR）',
  },
  'symptoms/suggest/route.ts': {
    auth: '未ログインで使える症状チェッカー。CSRF＋IP レート制限（10回/分）＋reCAPTCHA で守る',
  },
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(`${sep}route.ts`)) out.push(full);
  }
  return out;
}

/** 文字列・テンプレートリテラル・コメントの中身を、長さを保ったまま空白へ潰す。 */
export function maskNonCode(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out.push(' '.repeat(j - i));
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out.push(src.slice(i, j).replace(/[^\n]/g, ' '));
      i = j;
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out.push(quote + src.slice(i + 1, j).replace(/[^\n]/g, ' '));
      i = j;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join('');
}

const MUTATING = /export\s+(?:async\s+function|const|function)\s+(?:POST|PUT|PATCH|DELETE)\b/;

export function hasMutatingMethod(masked: string): boolean {
  return MUTATING.test(masked);
}

export function hasCsrfGuard(masked: string): boolean {
  if (/\bcheckCsrf\s*\(/.test(masked)) return true;
  // withRoute は既定で CSRF を検証する。`csrf: true` の明示があればそれで足りる。
  if (/\bcsrf\s*:\s*true\b/.test(masked)) return true;
  // `csrf: false` しか無い＝検証を明示的に外している。1 ファイルに GET(csrf:false) と
  // PUT(csrf:true) が同居する形（/api/profile）は上の行で先に true になる。
  if (/\bcsrf\s*:\s*false\b/.test(masked)) return false;
  return /\bwithRoute\s*\(/.test(masked);
}

export function hasRateLimitGuard(masked: string): boolean {
  return /\bcheckRateLimit\s*\(/.test(masked) || /\brateLimit\s*:/.test(masked);
}

/** 呼び出し元を identify する経路（どれか1つあればよい）。 */
const IDENTITY_PATTERNS: RegExp[] = [
  /\bauth\s*\.\s*getUser\s*\(/,      // Supabase セッション
  /\bgetUser\s*\(\s*\)/,
  /\brequireAuth\b/,                  // withRoute のオプション
  /\bcheckCronAuth\s*\(/,             // cron の Bearer シークレット
  /\brequirePlatformAdmin\s*\(/,      // プラットフォーム管理者
  /\bis_platform_admin\b/,
  /\bfacility_members\b/,             // 施設メンバーシップ
  /\bresolveLiffUserId\s*\(/,         // LIFF
  /\bverifyLineSignature\s*\(/,       // LINE 署名（Messaging API webhook）
  /\bverifyLineAccessToken\s*\(/,     // LINE アクセストークン（自社チャネル一致を検証）
  /\bverifySlackRequest\s*\(/,        // Slack 署名
  /\bconstructEvent\s*\(/,            // Stripe 署名
  /\bverifyApiKey\s*\(/,              // 施設 API キー
  /\bverifyUnsubscribeToken\s*\(/,    // 配信停止トークン
];

export function hasIdentityGate(masked: string): boolean {
  return IDENTITY_PATTERNS.some((re) => re.test(masked));
}

const files = walk(API_ROOT);
const scanned = files.map((full) => {
  const rel = relative(API_ROOT, full).split(sep).join('/');
  const masked = maskNonCode(readFileSync(full, 'utf8'));
  return { rel, masked, mutating: hasMutatingMethod(masked) };
});
const mutating = scanned.filter((f) => f.mutating);

describe('route.ts の CSRF / レート制限 / 本人確認を機械強制する', () => {
  // ── 空振り防止 ──────────────────────────────────────────────
  test('走査が空振りしていない（route.ts と変更系ルートが十分ある）', () => {
    expect(scanned.length).toBeGreaterThanOrEqual(100);
    expect(mutating.length).toBeGreaterThanOrEqual(80);
  });

  test('免除台帳の理由は空にできない', () => {
    for (const [path, ex] of Object.entries(ALLOW)) {
      for (const [aspect, reason] of Object.entries(ex)) {
        expect(`${path}:${aspect}:${(reason ?? '').trim()}`).not.toMatch(/:$/);
      }
    }
  });

  test('免除台帳に実在しないルートが残っていない', () => {
    const known = new Set(scanned.map((f) => f.rel));
    const stale = Object.keys(ALLOW).filter((p) => !known.has(p));
    expect(stale).toEqual([]);
  });

  // ── 本体 ────────────────────────────────────────────────────
  test('変更系メソッドを持つ route.ts は CSRF 検証を通る', () => {
    const violations = mutating
      .filter((f) => !hasCsrfGuard(f.masked) && !ALLOW[f.rel]?.csrf)
      .map((f) => f.rel);
    expect(violations).toEqual([]);
  });

  test('変更系メソッドを持つ route.ts はレート制限を通る', () => {
    const violations = mutating
      .filter((f) => !hasRateLimitGuard(f.masked) && !ALLOW[f.rel]?.rateLimit)
      .map((f) => f.rel);
    expect(violations).toEqual([]);
  });

  test('変更系メソッドを持つ route.ts は呼び出し元を identify する', () => {
    const violations = mutating
      .filter((f) => !hasIdentityGate(f.masked) && !ALLOW[f.rel]?.auth)
      .map((f) => f.rel);
    expect(violations).toEqual([]);
  });

  // ── 負の対照（検出関数が本当に効いているか合成コードで確かめる）──────
  describe('負の対照', () => {
    test('変更系メソッドの検出', () => {
      expect(hasMutatingMethod('export async function POST() {}')).toBe(true);
      expect(hasMutatingMethod('export const PATCH = withRoute(h)')).toBe(true);
      expect(hasMutatingMethod('export async function GET() {}')).toBe(false);
    });

    test('CSRF の検出', () => {
      expect(hasCsrfGuard('const e = checkCsrf(request);')).toBe(true);
      expect(hasCsrfGuard('export const POST = withRoute(h, {})')).toBe(true);
      // withRoute でも csrf: false しか無ければ免除されない
      expect(hasCsrfGuard('export const POST = withRoute(h, { csrf: false })')).toBe(false);
      // GET を csrf: false・PUT を csrf: true にしている形（/api/profile）は合格
      expect(hasCsrfGuard('withRoute(g,{csrf:false});withRoute(p,{csrf:true})')).toBe(true);
      expect(hasCsrfGuard('export async function POST() { return ok(); }')).toBe(false);
    });

    test('レート制限の検出', () => {
      expect(hasRateLimitGuard('await checkRateLimit(l, ip, 5, 60, "x")')).toBe(true);
      expect(hasRateLimitGuard('withRoute(h, { rateLimit: { limit: 5 } })')).toBe(true);
      expect(hasRateLimitGuard('export async function POST() { return ok(); }')).toBe(false);
    });

    test('本人確認の検出', () => {
      expect(hasIdentityGate('const { data } = await supabase.auth.getUser()')).toBe(true);
      expect(hasIdentityGate('withRoute(h, { requireAuth: true })')).toBe(true);
      expect(hasIdentityGate('const e = checkCronAuth(request)')).toBe(true);
      expect(hasIdentityGate('event = stripe.webhooks.constructEvent(b, s, k)')).toBe(true);
      expect(hasIdentityGate('export async function POST() { return ok(); }')).toBe(false);
    });

    test('コメントや文字列に書いただけでは合格にならない', () => {
      expect(hasCsrfGuard(maskNonCode('// checkCsrf(request) を後で足す\nexport async function POST(){}')))
        .toBe(false);
      expect(hasRateLimitGuard(maskNonCode('const msg = "checkRateLimit(x)";')))
        .toBe(false);
      expect(hasIdentityGate(maskNonCode('/* auth.getUser() は不要 */')))
        .toBe(false);
    });
  });
});
