/**
 * 店舗向けの入口を /register の 1 本にまとめたことを固定する（2026年10月23日 神原さん決定）。
 *
 * 「店舗向けの見た目は くすみ系（/register）に統一し、/salon を /register にまとめる。
 *  運営者の紹介・実際の掲載例は載せない。」
 *
 * 以前は /salon（青い LP・絵文字・節約シミュレーター）と /register（くすみ系）が並存し、
 * ヘッダー・フッターは /salon へ、/salon の CTA は /register へ、と同じ店舗が 2 枚の
 * 違う見た目のページを通らされていた。/salon/cases は運営元自身の施設の紹介、
 * /salon/demo は「保険適用バッジ」など施設が設定できない機能まで並べた機能一覧だった。
 *
 * 2026年10月23日（同日・神原さん決定）: 店舗の登録入口を /register に一本化する。/recruit には
 * 「施設登録（無料）」の別フォーム（/api/salons へ送る簡易版・source='recruit'）が残っており、
 * 同じ店舗が 2 つの違うフォームから申し込めた。/recruit も /register へ恒久転送し、フォームを撤去した。
 * サーバー側（/api/salons・DB の source='recruit'）は、過去の申込と転送前に開かれていたタブの
 * 送信を受けるため残す。
 *
 * 守るもの:
 *   - 旧 URL は消すのではなく /register へ恒久転送する（外部に貼られたリンク・営業資料のため）
 *   - 内部リンク・sitemap・llms.txt が旧 URL を指さない（転送を踏ませない・二重の入口を作らない）
 *   - 旧ページの実体が残っていない（転送の陰で古い約束が生き残らない）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const RETIRED = ['/salon', '/salon/cases', '/salon/demo', '/recruit'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mjs|txt|md)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe('店舗向けの入口は /register の 1 本', () => {
  const config = read('next.config.mjs');

  it.each(RETIRED)('%s は /register へ恒久転送する', (source) => {
    const pattern = new RegExp(
      `\\{\\s*source:\\s*'${source.replace(/\//g, '\\/')}',\\s*destination:\\s*'\\/register',\\s*permanent:\\s*true\\s*\\}`,
    );
    expect(config).toMatch(pattern);
  });

  it('有料プランの温存ページ（/salon/premium）は転送しない（notFound のまま）', () => {
    expect(config).not.toMatch(/source:\s*'\/salon\/premium'/);
    expect(config).not.toMatch(/source:\s*'\/salon\/:path\*'/);
    expect(read('src/app/salon/premium/page.tsx')).toContain('if (LAUNCH_HIDDEN) notFound()');
  });

  it.each(['src/app/salon/page.tsx', 'src/app/salon/layout.tsx', 'src/app/salon/cases', 'src/app/salon/demo', 'src/app/recruit'])(
    '旧ページの実体 %s が残っていない',
    (path) => {
      expect(existsSync(join(ROOT, path))).toBe(false);
    },
  );

  it('内部リンク・sitemap・llms.txt が旧 URL を指さない', () => {
    const files = [...walk('src'), ...walk('public'), ...walk('e2e')];
    // 空振り防止: 実際にファイルを走査している
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    const link = /(?:href=|url:\s*|['"`(])(?:https:\/\/(?:www\.)?carelink-jp\.com|\$\{SITE_URL\})?\/(?:salon(?:\/(?:cases|demo))?|recruit)(?=["'`)#?\s]|$)/m;
    // 転送そのものを実際の HTTP で確かめる E2E だけは、旧 URL を叩くのが仕事なので対象外。
    const REDIRECT_SPEC = 'e2e/shop-entry-redirects.spec.ts';
    expect(files).toContain(REDIRECT_SPEC);
    for (const file of files) {
      if (file === REDIRECT_SPEC) continue;
      const text = read(file);
      text.split('\n').forEach((line, i) => {
        // コメント行（経緯の説明）は対象外
        if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
        if (link.test(line)) offenders.push(`${relative(ROOT, join(ROOT, file))}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('sitemap は /register を店舗向けの入口として載せる', () => {
    const sitemap = read('src/app/sitemap.ts');
    expect(sitemap).toContain("{ url: `${SITE_URL}/register`, lastModified: updated, changeFrequency: 'weekly', priority: 0.9 }");
    expect(sitemap).not.toContain('${SITE_URL}/salon`');
    expect(sitemap).not.toContain('${SITE_URL}/recruit`');
  });

  it('ヘッダー・フッターの施設掲載リンクは /register', () => {
    expect(read('src/components/Header.tsx').match(/href="\/register"/g)?.length).toBe(2);
    expect(read('src/components/Footer.tsx').match(/href="\/register"/g)?.length).toBe(2);
    expect(read('src/components/search/SearchFooter.tsx')).toContain('href="/register"');
    expect(read('public/llms.txt')).toContain('https://carelink-jp.com/register');
  });

  // 店舗向けの申込フォームは /register の 1 つだけ。/recruit のフォームが使っていた
  // 「recruit」用のタブ内キー・source の切り替えもブラウザ側から消えている（到達しないコードを残さない）。
  it('ブラウザ側に /recruit 用の申込経路が残っていない', () => {
    // コメント（経緯の説明）は対象外。コード上の 'recruit' 値・RECRUIT 定数を見る。
    for (const file of ['src/lib/salon-registration-browser.ts', 'src/lib/salon-browser-context.ts']) {
      expect(read(file)).not.toMatch(/'recruit'|RECRUIT|recruit-submission/);
    }
    const forms = walk('src').filter((file) => /new SalonRegistrationBrowser\(/.test(read(file)));
    expect(forms).toEqual(['src/components/register/RegisterForm.tsx']);
  });
});
