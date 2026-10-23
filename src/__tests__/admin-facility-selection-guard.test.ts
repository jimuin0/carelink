/**
 * @jest-environment node
 *
 * 管理画面が「どの店舗を扱うか」を所属の 1 行目で決めないことを機械強制する（2026年10月22日 新設）。
 *
 * 【なぜ要るか】複数店舗のオーナー（2 店舗目以降は運営が facility_members に追加する）に対し、
 * 各画面が facility_members を `.limit(1)` で 1 行だけ読み、並び順で決まる任意の 1 店舗を扱っていた。
 * ヘッダーは「店舗未選択」なのに本文は別の店舗のデータ、ブログは別の店舗に公開、求人は作成不能、
 * という形で発症した（Q&A・回数券・月額プラン・カタログ・ブログ・求人・会計連携・QRコード・
 * 外部API・ファネル・利用状況）。口コミ・問い合わせと同じく ?facility_id= で選び、
 * `loadAdminFacilitySelection`（直接、または `AdminFacilityScope` 経由）で所属を確かめる形に揃えた。
 *
 * 【検査するもの】
 *   1. src/app/admin 配下のページが facility_members を `.limit(1)` 付きで読まないこと
 *      （ALLOW に理由つきで載っているものを除く。理由が空・実在しない・もう使っていない免除は不合格）
 *   2. 上記の画面が実際に店舗選択の仕組みへ配線されていること（判定関数が在るだけで
 *      使われていない状態を緑にしない）
 *   3. 検出関数そのものを合成コードで検査する負の対照（判定が壊れて全部合格に見える状態を防ぐ）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const ADMIN = join(ROOT, 'src/app/admin');

/** 免除台帳（src/app/admin からの相対パス → 理由）。 */
const ALLOW: Record<string, string> = {
  'featured-ads/page.tsx': '有料掲載枠は決済手段が未導入のため販売停止中（ローンチ時非表示）。販売を再開するときに店舗選択を入れる',
  'onboarding/page.tsx': '店舗を選ぶためではなく「既にどこかの店舗に所属しているか」の有無だけを見る（施設作成前の導線）',
};

/** 店舗を選んで使う画面（2026年10月22日に直したもの）。 */
const SELECTING_PAGES = [
  'qa/page.tsx', 'packages/page.tsx', 'subscription-plans/page.tsx',
  'catalog/page.tsx', 'catalog/new/page.tsx', 'catalog/[id]/edit/page.tsx',
  'blog/page.tsx', 'blog/new/page.tsx', 'blog/[id]/edit/page.tsx', 'jobs/new/page.tsx',
  'accounting/page.tsx', 'qrcode/page.tsx', 'api-keys/page.tsx', 'funnel/page.tsx', 'usage-stats/page.tsx',
  // 2026年10月23日: HPB メニュー取り込み（店舗IDの保存・取得・一括反映が選んだ店舗に効く）
  'hpb-menus/page.tsx',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : walk(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** facility_members を読む文のうち `.limit(1)` を含むものの数。 */
function firstMembershipReads(source: string): number {
  const code = stripComments(source);
  let count = 0;
  for (const match of code.matchAll(/from\(\s*['"]facility_members['"]\s*\)/g)) {
    const end = code.indexOf(';', match.index);
    const statement = code.slice(match.index, end === -1 ? undefined : end);
    if (/\.limit\(\s*1\s*\)/.test(statement)) count += 1;
  }
  return count;
}

const pages = walk(ADMIN).map(path => relative(ADMIN, path).split(sep).join('/'));
const read = (page: string) => readFileSync(join(ADMIN, page), 'utf8');

test('the scan covers the admin pages (guards against an empty walk)', () => {
  expect(pages.length).toBeGreaterThan(60);
  for (const page of SELECTING_PAGES) expect(pages).toContain(page);
});

test('no admin page picks a store by reading the first membership row', () => {
  const offenders = pages.filter(page => !ALLOW[page] && firstMembershipReads(read(page)) > 0);
  expect(offenders).toEqual([]);
});

test('every exemption has a reason, exists and still needs the exemption', () => {
  for (const [page, reason] of Object.entries(ALLOW)) {
    expect(reason.trim().length).toBeGreaterThan(10);
    expect(existsSync(join(ADMIN, page))).toBe(true);
    expect(firstMembershipReads(read(page))).toBeGreaterThan(0);
  }
});

test.each(SELECTING_PAGES)('%s is wired to the store selection', page => {
  const code = stripComments(read(page));
  expect(/\bloadAdminFacilitySelection\(|<AdminFacilityScope\b/.test(code)).toBe(true);
  expect(code).toContain('FacilitySelector');
});

describe('detector (negative controls)', () => {
  test('flags a first-row membership read', () => {
    expect(firstMembershipReads(`const { data } = await supabase.from('facility_members').select('facility_id')
      .eq('user_id', user.id).in('role', ['owner', 'admin']).limit(1).single();`)).toBe(1);
  });
  test('does not flag a selection that reads every membership', () => {
    expect(firstMembershipReads(`await db.from('facility_members').select('facility_id').eq('user_id', id).order('facility_id').limit(101);
      const x = rows.limit(1);`)).toBe(0);
  });
  test('ignores the pattern inside comments', () => {
    expect(firstMembershipReads(`// 以前は from('facility_members') を .limit(1).single() で読んでいた
      /* from('facility_members').limit(1); */ const url = 'https://example.invalid';`)).toBe(0);
  });
});
