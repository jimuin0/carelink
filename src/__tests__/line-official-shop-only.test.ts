/**
 * 2026年11月27日 本人決定：今の LINE 公式アカウント（相談 Bot と接続済み）は店舗用にする。
 * 友だち追加の入口は店舗向けの画面にだけ置き、来院者向けの画面（マイページ等）からは案内しない。
 */
import fs from 'fs';
import path from 'path';
import { SHOP_LINE_ADD_FRIEND_URL, SHOP_LINE_BASIC_ID } from '@/lib/line-official';

const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

test('友だち追加の URL は公式アカウントの ID から組み立てる', () => {
  expect(SHOP_LINE_ADD_FRIEND_URL).toBe(`https://line.me/R/ti/p/${SHOP_LINE_BASIC_ID}`);
});

test('店舗向けの画面（/register・管理画面のヘルプ）に LINE 相談の入口がある', () => {
  for (const rel of ['components/register/RegisterLanding.tsx', 'app/admin/help/page.tsx']) {
    expect(read(rel)).toContain('SHOP_LINE_ADD_FRIEND_URL');
  }
});

test('公式アカウントの ID を直書きしてよいのは line-official.ts だけ（来院者向けの画面に入口を戻さない）', () => {
  const offenders = walk(root)
    .filter((f) => !f.endsWith(path.join('lib', 'line-official.ts')))
    .filter((f) => fs.readFileSync(f, 'utf8').includes(SHOP_LINE_BASIC_ID))
    .map((f) => path.relative(root, f));
  expect(offenders).toEqual([]);
});

test('来院者のマイページは店舗用アカウントの友だち追加へ案内しない', () => {
  expect(read('app/mypage/profile/page.tsx')).not.toMatch(/SHOP_LINE_ADD_FRIEND_URL|line\.me\/R\/ti\/p/);
});
