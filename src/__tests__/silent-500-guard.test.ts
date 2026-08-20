/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 無音の 500 を構造で塞ぐ（2026年8月20日 新設・docs/register-blocker-instructions.md §3 P0-2）
 *
 * 【背景】`src/lib/with-route.ts` の catch は throw された例外でしか発火しない。
 * ハンドラが例外を投げずに `return NextResponse.json(..., {status:500})` した場合
 * （自前 try/catch・Supabase の `{data,error}` 判定など）は catch を素通りし、
 * Slack にも Sentry にも一切載らない。`/api/salons` の登録失敗が誰にも気づかれなかった
 * 直接の原因がこれだった。
 *
 * `with-route.ts` 側の恒久対処（handler の戻り値も status で判定して通知する）で
 * withRoute を通るルートは自動的に塞がった。本テストの主眼はその外側 ――
 * 【withRoute を使っていない route.ts が無音の 500 を返していないか】を機械監視すること。
 *
 * 【検出方法（ヒューリスティック・完全な静的解析ではない）】
 *   1. 文字列・テンプレートリテラル・コメントの中身を空白へ置換する（括弧の対応が
 *      文字列中の '(' でズレるのを防ぐ）
 *   2. `withRoute(...)` 呼び出し全体を括弧の対応で特定する。その範囲内にある
 *      `status: 500` は with-route.ts の構造修正で自動的に通知されるため対象外
 *   3. 範囲外の `status: 500` は、直前最大400字/直後100字の窓に
 *      `alertCaughtError` / `safeCaptureException` / `serverError` / `logCronRun`
 *      の呼び出しがあれば「通知経路に載っている」とみなす
 *      （`logCronRun('...', 'error', ...)` は cron-logger.ts が内部で alertCaughtError を
 *      呼ぶため、cron 各ルートの「唯一の通報チョークポイント」＝CLAUDE.md の記載どおり）
 *
 * 完全な制御フロー解析ではないため、近傍に通知呼び出しがあっても実際にはその return が
 * 通知を経由しない経路（例: catch ブロックの手前で return している等）を「wired」と
 * 誤判定しうる（既知の限界。false negative＝見逃し方向）。逆に「新規に増えた・
 * 台帳に無い無音 500」は捕まえる設計なので、次に足される違反を守るガードとして機能する。
 *
 * 【空振り防止】stock-image-guard-wiring.test.ts と同じ設計:
 *   - 走査対象ファイル数が一定数以上あること
 *   - status: 500 の検出件数が一定数以上あること
 *   - 検出ロジック自体を合成コードで検証する負の対照テストを併設
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const API_ROOT = join(ROOT, 'src/app/api');

function walk(dir: string, accept: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

/**
 * 文字列リテラル・テンプレートリテラル・コメントの中身を、長さを保ったまま空白に置換する。
 * 括弧の対応付け（withRoute(...) の範囲特定）と通知呼び出しの近傍検索が、文字列や
 * コメント中の紛らわしい文字列に惑わされないようにする前処理。
 *
 * 既知の制限: テンプレートリテラル内の `${...}` 補間にネストしたバッククォートが
 * 含まれるケースは考慮していない（このリポジトリの route.ts では発生していないことを
 * 走査結果で確認済み）。
 */
function maskNonCode(src: string): string {
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
      out.push(src.slice(i, j).replace(/[^\n]/g, ' '));
      i = j;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join('');
}

/** masked[openIdx] === '(' からの対応する ')' の文字インデックスを返す。 */
function findMatchingParen(masked: string, openIdx: number): number {
  let depth = 0;
  for (let k = openIdx; k < masked.length; k++) {
    if (masked[k] === '(') depth++;
    else if (masked[k] === ')') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return masked.length - 1;
}

const WITHROUTE_CALL_RE = /\bwithRoute\s*(\()/g;
const NOTIFY_CALL_RE = /\b(?:alertCaughtError|safeCaptureException|serverError|logCronRun)\s*\(/;
const STATUS_500_RE = /status:\s*500/g;

/** withRoute(...) 呼び出し全体の [開始, 終了] 文字インデックス範囲を全て返す。 */
function withRouteSpans(masked: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  WITHROUTE_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WITHROUTE_CALL_RE.exec(masked))) {
    const openIdx = m.index + m[0].length - 1; // '(' の位置
    const endIdx = findMatchingParen(masked, openIdx);
    spans.push([m.index, endIdx]);
  }
  return spans;
}

interface AnalyzeResult {
  total500: number;
  /** 通知経路に載っていない `status: 500` の行番号（1始まり） */
  unwiredLines: number[];
}

function analyzeRouteSource(src: string): AnalyzeResult {
  const masked = maskNonCode(src);
  const spans = withRouteSpans(masked);
  const unwiredLines: number[] = [];
  let total500 = 0;

  STATUS_500_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATUS_500_RE.exec(src))) {
    total500++;
    const idx = m.index;
    const coveredByWithRoute = spans.some(([s, e]) => idx >= s && idx <= e);
    if (coveredByWithRoute) continue;

    const windowStart = Math.max(0, idx - 400);
    const windowEnd = Math.min(masked.length, idx + 100);
    const window = masked.slice(windowStart, windowEnd);
    if (NOTIFY_CALL_RE.test(window)) continue;

    unwiredLines.push(src.slice(0, idx).split('\n').length);
  }
  return { total500, unwiredLines };
}

/**
 * 【既知の未解決分の台帳】2026年8月20日、上記ロジックで実測した「withRoute を使っておらず、
 * 通知経路にも載っていない route.ts」の一覧。route.ts 自体の中身は本タスクのスコープ外
 * （変更禁止）のため、ここに載っている83ファイルは【この検査の新設時点で既に無音だった】
 * 既知のバックログであり、今回の変更で新たに増えたものではない。
 *
 * 台帳の意味:
 *   - ここに無いファイルが新たに無音 500 を持つようになったら CI が落ちる（新規流入の防止）
 *   - ここに載っているファイルが実際にはもう無音でなくなったら CI が落ちる
 *     （withRoute 化・serverError 化した際に台帳の更新を強制し、記載の陳腐化を防ぐ）
 */
const KNOWN_UNWIRED_FILES: string[] = [
  'src/app/api/admin/accounting-export/route.ts',
  'src/app/api/admin/ai-support/route.ts',
  'src/app/api/admin/api-keys/[id]/route.ts',
  'src/app/api/admin/api-keys/route.ts',
  'src/app/api/admin/backup/route.ts',
  'src/app/api/admin/blog/[id]/route.ts',
  'src/app/api/admin/blog/route.ts',
  'src/app/api/admin/booking-checkout/route.ts',
  'src/app/api/admin/booking-status/route.ts',
  'src/app/api/admin/bookings/route.ts',
  'src/app/api/admin/catalog/[id]/route.ts',
  'src/app/api/admin/catalog/route.ts',
  'src/app/api/admin/chain/bulk-coupon/route.ts',
  'src/app/api/admin/chain/bulk-publish/route.ts',
  'src/app/api/admin/coupons/[id]/route.ts',
  'src/app/api/admin/coupons/route.ts',
  'src/app/api/admin/customers/[id]/route.ts',
  'src/app/api/admin/customers/route.ts',
  'src/app/api/admin/facility-verify/route.ts',
  'src/app/api/admin/feature-flags/[id]/route.ts',
  'src/app/api/admin/feature-flags/route.ts',
  'src/app/api/admin/featured-ads/route.ts',
  'src/app/api/admin/features/[id]/route.ts',
  'src/app/api/admin/features/route.ts',
  'src/app/api/admin/gbp/place/route.ts',
  'src/app/api/admin/gbp/posts/route.ts',
  'src/app/api/admin/hpb-menus/apply/route.ts',
  'src/app/api/admin/hpb-menus/route.ts',
  'src/app/api/admin/inquiries/[id]/reply/route.ts',
  'src/app/api/admin/inquiries/[id]/route.ts',
  'src/app/api/admin/job-applications/[id]/route.ts',
  'src/app/api/admin/job-applications/route.ts',
  'src/app/api/admin/jobs/route.ts',
  'src/app/api/admin/menus/[id]/route.ts',
  'src/app/api/admin/menus/route.ts',
  'src/app/api/admin/moderation/[id]/route.ts',
  'src/app/api/admin/newsletter/[id]/route.ts',
  'src/app/api/admin/newsletter/route.ts',
  'src/app/api/admin/packages/[id]/route.ts',
  'src/app/api/admin/packages/route.ts',
  'src/app/api/admin/payments-settings/route.ts',
  'src/app/api/admin/platform-blog/[id]/route.ts',
  'src/app/api/admin/platform-blog/route.ts',
  'src/app/api/admin/qa/route.ts',
  'src/app/api/admin/registrations/[id]/route.ts',
  'src/app/api/admin/registrations/route.ts',
  'src/app/api/admin/report/route.ts',
  'src/app/api/admin/review-summary/route.ts',
  'src/app/api/admin/settings/route.ts',
  'src/app/api/admin/staff/[id]/route.ts',
  'src/app/api/admin/staff/[id]/schedule/route.ts',
  'src/app/api/admin/staff/route.ts',
  'src/app/api/admin/subscription-plans/[id]/route.ts',
  'src/app/api/admin/subscription-plans/route.ts',
  'src/app/api/admin/user-packages/route.ts',
  'src/app/api/admin/user-subscriptions/route.ts',
  'src/app/api/admin/white-label/verify/route.ts',
  'src/app/api/alert-check/route.ts',
  'src/app/api/booking/[id]/cancel/route.ts',
  'src/app/api/booking/[id]/change/route.ts',
  'src/app/api/booking/[id]/ical/route.ts',
  'src/app/api/booking/route.ts',
  'src/app/api/facility/setup/route.ts',
  'src/app/api/google-calendar/route.ts',
  'src/app/api/google-calendar/sync/route.ts',
  'src/app/api/intake/route.ts',
  'src/app/api/liff/link/route.ts',
  'src/app/api/line/webhook/route.ts',
  'src/app/api/nps/route.ts',
  'src/app/api/options/inquiry/route.ts',
  'src/app/api/payment/checkout/route.ts',
  'src/app/api/payment/webhook/route.ts',
  'src/app/api/push/subscribe/route.ts',
  'src/app/api/referral/route.ts',
  'src/app/api/review/[id]/route.ts',
  'src/app/api/review/route.ts',
  'src/app/api/stripe/checkout/route.ts',
  'src/app/api/stripe/receipt/route.ts',
  'src/app/api/symptoms/suggest/route.ts',
  'src/app/api/unsubscribe/route.ts',
  'src/app/api/v1/bookings/route.ts',
  'src/app/api/v1/customers/route.ts',
  'src/app/api/waitlist/route.ts',
];

describe('無音の500の構造ガード（withRoute 未使用の route.ts）', () => {
  const routeFiles = walk(API_ROOT, (p) => p.endsWith(`${sep}route.ts`));

  it('走査対象が十分な数ある（空振り防止）', () => {
    // 実測（2026年8月20日）130本。腐りを検知できるよう実測より少し低い下限にする。
    expect(routeFiles.length).toBeGreaterThanOrEqual(100);
  });

  it('status: 500 の検出件数が十分な数ある（空振り防止）', () => {
    let total500 = 0;
    for (const file of routeFiles) {
      total500 += analyzeRouteSource(readFileSync(file, 'utf8')).total500;
    }
    // 実測（2026年8月20日）278件。腐りを検知できるよう実測より少し低い下限にする。
    expect(total500).toBeGreaterThanOrEqual(200);
  });

  it('無音の500が台帳(KNOWN_UNWIRED_FILES)を超えて増えていない・台帳が陳腐化していない', () => {
    const detected: string[] = [];
    for (const file of routeFiles) {
      const { unwiredLines } = analyzeRouteSource(readFileSync(file, 'utf8'));
      if (unwiredLines.length > 0) {
        detected.push(relative(ROOT, file).split(sep).join('/'));
      }
    }
    detected.sort();

    // 台帳に無い新規の無音500（withRoute を使っていない route.ts に新たに足された、
    // あるいは既存の通知呼び出しが削られた箇所）。1件でもあれば CI で落ちる。
    const extra = detected.filter((f) => !KNOWN_UNWIRED_FILES.includes(f));
    // 台帳に載っているが実際にはもう無音ではない（withRoute 化・serverError 化された）。
    // 台帳の更新漏れを防ぐため、これも CI で落とす。
    const stale = KNOWN_UNWIRED_FILES.filter((f) => !detected.includes(f));

    expect(extra).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe('検出ロジックの自己検証（負の対照・合成コードで確認）', () => {
  it('withRoute でラップされたハンドラの 500 は無音とみなさない', () => {
    const src = `
import { withRoute } from '@/lib/with-route';
export const POST = withRoute(async (request) => {
  const { data, error } = await supabase.from('x').insert({});
  if (error || !data) {
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}, {
  csrf: true,
  rateLimit: { limiter: null, limit: 5, windowMs: 60_000, prefix: 'p' },
});
`;
    const { total500, unwiredLines } = analyzeRouteSource(src);
    expect(total500).toBe(1);
    expect(unwiredLines).toEqual([]);
  });

  it('withRoute を使わず通知呼び出しも無い 500 は無音として検出する', () => {
    const src = `
export async function GET(req: Request) {
  try {
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'x' }, { status: 500 });
  }
}
`;
    const { total500, unwiredLines } = analyzeRouteSource(src);
    expect(total500).toBe(1);
    // status: 500 は6行目（1始まり）にある。
    expect(unwiredLines).toEqual([6]);
  });

  it('withRoute を使わなくても近傍で通知していれば無音とみなさない', () => {
    const src = `
export async function GET(req: Request) {
  try {
    return NextResponse.json({ ok: true });
  } catch (e) {
    safeCaptureException(e, 'tag');
    alertCaughtError('tag', e, '/api/x');
    return NextResponse.json({ error: 'x' }, { status: 500 });
  }
}
`;
    const { unwiredLines } = analyzeRouteSource(src);
    expect(unwiredLines).toEqual([]);
  });

  it('cron ルートは logCronRun(...,\'error\',...) を近傍検知して無音とみなさない', () => {
    const src = `
export async function GET(req: Request) {
  try {
    return NextResponse.json({ processed: 1 });
  } catch (e) {
    await logCronRun('my-job', 'error', startedAt, { error_msg: String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
`;
    const { unwiredLines } = analyzeRouteSource(src);
    expect(unwiredLines).toEqual([]);
  });

  it('文字列・コメント中の紛らわしい括弧に惑わされず withRoute の範囲を特定する', () => {
    const src = `
// withRoute(fake) というコメントは呼び出しではない
const note = "withRoute(also fake)";
export const POST = withRoute(async (request) => {
  const s = "文字列の中の ) はここで閉じない";
  if (bad) return NextResponse.json({ error: 'x' }, { status: 500 });
  return NextResponse.json({ ok: true });
}, { csrf: true });
`;
    const { unwiredLines } = analyzeRouteSource(src);
    expect(unwiredLines).toEqual([]);
  });
});
