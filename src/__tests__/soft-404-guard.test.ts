/**
 * 存在しない公開URLが HTTP 404 を返し続けることを固定する（2026年7月30日 新設）。
 *
 * 【背景・本番ビルドの実測で確定した根本原因】
 * 存在しないURLが軒並み HTTP 200 を返していた（本番・ローカルの両方で再現）。
 * 原因は loading.tsx が作る Suspense 境界。Next.js はストリーミングを開始する時点で
 * 200 をヘッダに確定させるため、そのあとページ本体が notFound() を投げても
 * 404 に変えられない。ルートに一致しない深いパス（page.tsx が動かない）だけが 404 だった。
 *
 * 【検証した3案のうち、効いたのは1つだけ（すべて本番ビルドで実測）】
 *   1. generateMetadata の中で notFound() を呼ぶ  → 200 のまま（効かない）
 *   2. dynamicParams = false を付ける              → 200 のまま（効かない）
 *   3. 該当ルートを覆う loading.tsx を外す         → 404 になる（有効）
 * dev サーバでの検証は本番ビルドと挙動が違うため、判断は本番ビルドで行うこと。
 *
 * 【このテストが守るもの】
 * 公開ルート（sitemap に載り、検索エンジンがクロールしうる範囲）に loading.tsx を
 * 足し戻すと、そのルート配下の 404 が静かに 200 に戻る。数値やレスポンスに現れず、
 * ブラウザで見ても気づけないため、ファイルの有無で機械的に止める。
 * 認証配下（admin / mypage / auth）はクロールされないので loading.tsx を残してよい。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const APP = join(root, 'src/app');

/**
 * loading.tsx を置いてよい領域（認証配下＝クローラが到達しない）。
 * ここ以外は「配下に notFound() を呼ぶ page.tsx があるか」で個別に判定する。
 */
const ALLOWED_PREFIXES = ['admin', 'mypage', 'auth'];

/** APP 配下を歩いて、条件に合うファイルの相対パスを集める。 */
function walk(rel: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  const abs = rel ? join(APP, rel) : APP;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name === '__tests__') continue;
      out.push(...walk(childRel, match));
    } else if (match(entry.name)) {
      out.push(childRel);
    }
  }
  return out;
}

const LOADING_FILES = walk('', (n) => n === 'loading.tsx');
/** notFound() を呼ぶ page.tsx のディレクトリ一覧。 */
const NOT_FOUND_DIRS = walk('', (n) => n === 'page.tsx')
  .filter((p) => readFileSync(join(APP, p), 'utf8').includes('notFound()'))
  .map((p) => p.replace(/\/page\.tsx$/, '').replace(/^page\.tsx$/, ''));

describe('ソフト404の再発防止', () => {
  /**
   * 禁止するのは「404 しうるルートを覆う loading.tsx」だけ。
   * 404 しないページ（/symptom-checker・/salon/demo など）のスケルトンは残してよい。
   * 将来ルートが増えても、notFound() の有無から自動で判定される。
   */
  test('404しうる公開ルートを覆う loading.tsx が無い', () => {
    const offenders = LOADING_FILES.filter((lp) => {
      if (ALLOWED_PREFIXES.some((a) => lp === `${a}/loading.tsx` || lp.startsWith(`${a}/`))) return false;
      const dir = lp.replace(/\/?loading\.tsx$/, '');
      // この loading.tsx が覆う範囲（自ディレクトリ以下）に notFound() を呼ぶページがあるか
      return NOT_FOUND_DIRS.some((nd) => (dir === '' ? true : nd === dir || nd.startsWith(`${dir}/`)));
    });
    expect(offenders).toEqual([]);
  });

  test('認証配下と404しないページのスケルトンは残っている（過剰に消していない）', () => {
    expect(LOADING_FILES).toContain('admin/loading.tsx');
    expect(LOADING_FILES).toContain('mypage/loading.tsx');
    expect(LOADING_FILES).toContain('symptom-checker/loading.tsx');
  });

  /**
   * /ranking/[area] は area を無検証で受けており、任意の文字列がそのまま
   * <title>{area}の人気ランキング</title> に反映されていた。
   * 実測: /ranking/does-not-exist が 200 で「does-not-existの人気ランキング」を返した。
   * 無限に生成できるURLが CareLink ブランドのページとして成立してしまうため、
   * 実在する都道府県だけを受け付ける。
   */
  test('/ranking/[area] は実在する都道府県だけを受け付ける', () => {
    const src = readFileSync(join(APP, 'ranking/[area]/page.tsx'), 'utf8');
    expect(src).toContain("import { notFound } from 'next/navigation';");
    // generateMetadata と本体の両方で弾く（片方だけだとタイトルが先に出る）
    const guards = src.match(/if \(!prefectures\.includes\(area\)\) notFound\(\);/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  // 404 を返すべきルートの page.tsx が notFound() を持ち続けていること。
  // loading.tsx を消しても、notFound() 自体が消えたら 404 にならない。
  test.each([
    ['facility/[slug]'],
    ['blog/[slug]'],
    ['feature/[slug]'],
    ['symptom/[slug]'],
    ['jobs/[id]'],
    ['type/[typeSlug]'],
    ['[prefectureSlug]'],
    ['search/area/[slug]'],
  ])('%s は notFound() を呼ぶ', (route) => {
    const p = join(APP, route, 'page.tsx');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('notFound()');
  });
});
