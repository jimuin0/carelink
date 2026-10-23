/** @jest-environment node */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * 来院者向け画面のデザインの割れを戻さないための検査（デザイン統一フェーズ1・2026年10月23日）。
 *
 * why（本番で実測した状態）:
 *   - ボタンの見た目が 13 通り（角丸 4/8/12px/丸、高さ 32〜56px、グラデーション・影の有無）。
 *   - 12px 未満の文字（text-micro 10px・text-tiny 11px・text-[9〜11px]）がトップ・検索・施設ページに散在。
 *   共通部品（src/components/ui/Button・Select）へ寄せたが、検査が無ければ次の画面追加で必ず戻る。
 *
 * 何を止めるか（来院者向けのソース＝src/app と src/components のうち、admin・api・__tests__・ui 以外）:
 *   1. 12px 未満の文字サイズ（text-micro / text-tiny / text-[<12px] / text-[<0.75rem]）。
 *   2. ボタン・リンクの要素に手書きした「ボタンの色」:
 *      btn-primary / btn-secondary / btn-outline のユーティリティ、
 *      ブランド色の塗り（bg-sky-500〜900・bg-primary・bg-(--primary)）＋白文字、sky のグラデーション。
 *      → src/components/ui/Button を使う。
 *
 * 残してよい箇所は台帳（BASELINE）で件数を固定している（フェーズ2で操作ボタンは置き換え済み。残りは理由つき）。
 * 件数が【増えたら】退行として落ちる。【減ったら】台帳の更新を求めて落ちる（台帳が実態から腐らないように）。
 * 管理画面（src/app/admin・src/components/admin）はフェーズ1の対象外なので走査しない。
 */

const ROOT = process.cwd();
const SCAN_DIRS = ['src/app', 'src/components'];
const EXCLUDED_DIRS = ['src/app/admin', 'src/app/api', 'src/components/admin', 'src/components/ui'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(ROOT, path).split(sep).join('/');
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || EXCLUDED_DIRS.includes(rel)) return [];
      return walk(path);
    }
    return /\.(tsx|ts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [rel] : [];
  });
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).sort();
const sources = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

// ---------------------------------------------------------------------------
// 1. 12px 未満の文字
// ---------------------------------------------------------------------------
const SIZE_TOKEN = /(?<![\w-])text-(micro|tiny|\[(\d+(?:\.\d+)?)(px|rem)\])(?![\w-])/g;

export function subTwelvePxTokens(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(SIZE_TOKEN)) {
    if (m[1] === 'micro' || m[1] === 'tiny') {
      found.push(m[0]);
      continue;
    }
    const value = Number(m[2]);
    const px = m[3] === 'rem' ? value * 16 : value;
    if (px < 12) found.push(m[0]);
  }
  return found;
}

/**
 * 12px 未満を残してよい箇所（理由必須）。
 * トップのヒーローは「デザイン統一の初期段階ではヒーローを変えない」（2026年10月23日 神原さん決定）。
 */
const SMALL_TEXT_ALLOW: Record<string, { count: number; reason: string }> = {
  'src/app/page.tsx': {
    count: 2,
    reason: 'トップのヒーロー（「5分 かんたん予約」「24h ネット予約対応」の補足・スマホ 11px）。ヒーローは神原さん決定で凍結中',
  },
};

// ---------------------------------------------------------------------------
// 2. ボタン・リンク要素に手書きしたボタンの色
// ---------------------------------------------------------------------------

/** `<button` / `<a` / `<Link` / `<BrowseLink` の開始タグを、波括弧・文字列の中の `>` を飛ばして切り出す。 */
export function openingTags(source: string): string[] {
  const tags: string[] = [];
  const start = /<(button|a|Link|BrowseLink)(?=[\s>])/g;
  for (const m of source.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index! + m[0].length;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index!, i + 1));
  }
  return tags;
}

const BUTTON_UTILITY = /(?<![\w-])btn-(?:primary|secondary|outline)(?![\w-])/;
const BRAND_FILL = /(?<![\w:-])bg-(?:sky-[5-9]00|primary|\(--primary\)|\[var\(--primary\)\])(?![\w-])/;
const WHITE_TEXT = /(?<![\w:-])text-white(?![\w-])/;
const SKY_GRADIENT = /bg-(?:linear|gradient)-to-[a-z]+[^"'`]*\bfrom-sky-[5-9]00/;

export function rawButtonStyles(source: string): string[] {
  return openingTags(source).filter(
    (tag) => BUTTON_UTILITY.test(tag) || (BRAND_FILL.test(tag) && WHITE_TEXT.test(tag)) || SKY_GRADIENT.test(tag),
  );
}

/**
 * 手書きのボタンの色を残してよい箇所（件数は実測値と【厳密一致】させる）。
 * フェーズ2（2026年10月23日）で来院者向け・店舗登録の操作ボタンは全て Button へ置き換えた。
 * 残っているのは「操作の強さ」ではなく【選択状態・現在地の表示】や、通常のボタンとは別の部品（円形の
 * アイコンボタン・FAB）、凍結中のヒーローだけ。理由の無い行は足さないこと。
 */
const RAW_BUTTON_BASELINE: Record<string, number> = {
  // 円形のアイコンボタン（送信アイコン 44px・画面に浮かぶ起動ボタン 56px）。文字のボタンとは別の部品
  'src/components/AiChatbot.tsx': 2,
  // 空き枠の選択状態（選んだ時刻のセル）。操作ボタンではない
  'src/components/booking/BookingFlow.tsx': 1,
  // 絞り込みタグの選択状態。操作ボタンではない
  'src/components/facility/CatalogList.tsx': 2,
  // マイページのタブの現在地（aria-current="page"）。操作ボタンではない
  'src/components/mypage/MyPageNav.tsx': 1,
  // トップのヒーロー内の検索ボタン（ヒーローは神原さん決定で凍結中）
  'src/components/search/HomeSearchForm.tsx': 1,
  // 画面に浮かぶ丸い絞り込みボタン（FAB）。通常のボタンとは別の部品として扱う
  'src/components/search/MobileFilterButton.tsx': 1,
  // 現在のページ番号の強調（選択状態の表示）
  'src/components/search/Pagination.tsx': 1,
};

// ---------------------------------------------------------------------------

describe('検査そのものが空振りしていない', () => {
  it('来院者向けのソースを十分な数だけ走査している', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain('src/components/facility/StickyBookingBar.tsx');
    expect(files.some((f) => f.startsWith('src/app/admin/') || f.startsWith('src/components/admin/'))).toBe(false);
    expect(files.some((f) => f.startsWith('src/components/ui/'))).toBe(false);
  });

  it('12px 未満の検出: micro/tiny と 12px・0.75rem 未満の任意値を拾い、12px 以上は拾わない', () => {
    expect(subTwelvePxTokens('text-micro text-tiny text-[9px] text-[10px] text-[11px] text-[11.5px] text-[0.6875rem]')).toHaveLength(7);
    expect(subTwelvePxTokens('text-xs text-[12px] text-[13px] text-[0.75rem] text-[0.8125rem] text-tiny-x')).toEqual([]);
  });

  it('手書きボタンの検出: ユーティリティ・ブランド色の塗り＋白文字・sky のグラデーションを拾う', () => {
    expect(rawButtonStyles('<button type="button" className="btn-primary w-full">送信</button>')).toHaveLength(1);
    expect(rawButtonStyles('<Link href="/x" className="px-5 py-2.5 bg-sky-700 text-white rounded-lg">x</Link>')).toHaveLength(1);
    expect(rawButtonStyles('<a href="/x" className={`flex ${on ? "bg-primary text-white" : ""}`}>x</a>')).toHaveLength(1);
    expect(rawButtonStyles('<Link href="/b" className="bg-linear-to-r from-sky-500 to-sky-600 text-white">予約</Link>')).toHaveLength(1);
    // ボタンでない要素・淡い面・枠線だけの要素は拾わない
    expect(rawButtonStyles('<span className="bg-sky-700 text-white">AI</span>')).toEqual([]);
    expect(rawButtonStyles('<Link href="/x" className="bg-sky-50 text-sky-700">x</Link>')).toEqual([]);
    expect(rawButtonStyles('<Button href="/x">x</Button>')).toEqual([]);
    // 波括弧の中の > で開始タグを切らない
    expect(openingTags('<button onClick={() => a > b} className="btn-primary">x</button>')).toEqual([
      '<button onClick={() => a > b} className="btn-primary">',
    ]);
  });
});

describe('来院者向けの文字は 12px 以上', () => {
  const actual = Object.fromEntries(
    [...sources].map(([f, s]) => [f, subTwelvePxTokens(s).length] as const).filter(([, n]) => n > 0),
  );

  it('台帳にない箇所で 12px 未満の文字を使わない（text-micro / text-tiny / text-[<12px] は text-xs 以上へ）', () => {
    const offenders = Object.entries(actual).filter(([f, n]) => n > (SMALL_TEXT_ALLOW[f]?.count ?? 0));
    expect(offenders).toEqual([]);
  });

  it('台帳は実態と一致し、理由が書かれている（直した箇所の免除を残さない）', () => {
    for (const [file, { count, reason }] of Object.entries(SMALL_TEXT_ALLOW)) {
      expect(reason.trim()).not.toBe('');
      expect({ file, count: actual[file] ?? 0 }).toEqual({ file, count });
    }
  });
});

describe('来院者向けのボタンは src/components/ui/Button を使う', () => {
  const actual = Object.fromEntries(
    [...sources].map(([f, s]) => [f, rawButtonStyles(s).length] as const).filter(([, n]) => n > 0),
  );

  it('手書きのボタンの色が台帳の件数と厳密に一致する（増えたら Button を使う／減ったら台帳を下げる）', () => {
    expect(actual).toEqual(RAW_BUTTON_BASELINE);
  });

  it('Button に置き換えた画面（フェーズ1・2）には手書きのボタンの色が無い', () => {
    const migrated = [
      'src/app/not-found.tsx',
      'src/app/error.tsx',
      'src/app/search/page.tsx',
      'src/app/search/error.tsx',
      'src/app/facility/[slug]/error.tsx',
      'src/app/facility/[slug]/not-found.tsx',
      'src/app/facility/[slug]/booking/page.tsx',
      'src/app/facility/[slug]/booking/complete/page.tsx',
      'src/app/auth/error.tsx',
      'src/app/auth/login/page.tsx',
      'src/app/auth/signup/page.tsx',
      'src/app/auth/forgot-password/page.tsx',
      'src/app/auth/reset-password/page.tsx',
      'src/components/facility/StickyBookingBar.tsx',
      'src/components/facility/InquiryForm.tsx',
      'src/components/facility/ReviewForm.tsx',
      'src/components/facility/ReviewTab.tsx',
      'src/components/facility/QASection.tsx',
      'src/components/search/SearchBar.tsx',
      'src/components/search/SearchFilters.tsx',
      'src/components/search/HomeUserPanel.tsx',
      'src/components/home/StickySignupCta.tsx',
      'src/components/home/ReferralInviteNotice.tsx',
      // フェーズ2（2026年10月23日）
      'src/app/blog/error.tsx',
      'src/app/compare/error.tsx',
      'src/app/compare/page.tsx',
      'src/app/contact/error.tsx',
      'src/app/contact/page.tsx',
      'src/app/feature/[slug]/page.tsx',
      'src/app/jobs/[id]/page.tsx',
      'src/app/jobs/page.tsx',
      'src/app/liff/bookings/page.tsx',
      'src/app/liff/cancel/page.tsx',
      'src/app/mypage/bookings/[id]/change/page.tsx',
      'src/app/mypage/bookings/[id]/page.tsx',
      'src/app/mypage/coupons/page.tsx',
      'src/app/mypage/page.tsx',
      'src/app/mypage/profile/page.tsx',
      'src/app/mypage/referral/page.tsx',
      'src/app/mypage/reviews/[id]/edit/page.tsx',
      'src/app/mypage/staff/page.tsx',
      'src/app/ranking/[area]/error.tsx',
      'src/app/ranking/[area]/page.tsx',
      'src/app/ranking/page.tsx',
      'src/app/register/complete/page.tsx',
      'src/app/register/error.tsx',
      'src/app/register/recover/page.tsx',
      'src/app/salon/premium/page.tsx',
      'src/app/symptom/[slug]/page.tsx',
      'src/app/symptoms/SymptomCheckerClient.tsx',
      'src/app/symptoms/page.tsx',
      'src/app/unsubscribe/page.tsx',
      'src/components/ConfirmDialog.tsx',
      'src/components/intake/IntakeForm.tsx',
      'src/components/push/PushPermissionBanner.tsx',
      'src/components/register/RegisterForm.tsx',
      'src/components/register/RegistrationReceipt.tsx',
    ];
    for (const file of migrated) {
      expect({ file, raw: rawButtonStyles(sources.get(file)!) }).toEqual({ file, raw: [] });
      expect(sources.get(file)).toContain("from '@/components/ui/Button'");
    }
  });
});
