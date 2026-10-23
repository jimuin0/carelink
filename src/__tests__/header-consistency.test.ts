/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 一般の Header と検索サイト側の SearchHeader は LayoutSwitch.tsx がページごとに切り替えるため、
 * 見た目がずれると移動のたびにロゴの大きさ・ヘッダーの高さが変わって見える（本番の監査で
 * ロゴ 20px⇄24px・高さ 56px⇄64px を実測、2026年10月23日）。
 * 共通の値は src/components/header-styles.ts に置き、ロゴの class は両方に同じ文字列で書く。
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const header = read('src/components/Header.tsx');
const searchHeader = read('src/components/search/SearchHeader.tsx');
const styles = read('src/components/header-styles.ts');

const logoClasses = (source: string) => [...source.matchAll(/<Link href="\/" className="([^"]*)"/g)].map((m) => m[1]);

it('ロゴ（<Link href="/">）の class は 3 か所（来院者向け・店舗向け・検索サイト側）で同じ文字列', () => {
  const all = [...logoClasses(header), ...logoClasses(searchHeader)];
  expect(all).toHaveLength(3);
  expect(new Set(all).size).toBe(1);
  expect(all[0]).toContain('text-xl');
  expect(all[0]).toContain('text-(--logo)');
});

it('ヘッダーの行の高さは共通の HEADER_BAR（56px）を使い、h-16 などを直書きしない', () => {
  expect(styles).toMatch(/export const HEADER_BAR = '[^']*\bh-14\b[^']*'/);
  for (const source of [header, searchHeader]) {
    expect(source).toContain('className={HEADER_BAR}');
    expect(source).not.toMatch(/justify-between h-1[0-9]/);
  }
  // Header は店舗向け・来院者向けの 2 つの行を持つ
  expect(header.match(/className=\{HEADER_BAR\}/g)).toHaveLength(2);
});

it('右側のリンク（店舗ログイン・掲載の案内・スマホのメニュー）は両方とも共通の値を使う', () => {
  for (const name of [
    'HEADER_NAV_LINK',
    'HEADER_LISTING_LINK',
    'HEADER_ACCOUNT_GROUP',
    'HEADER_STORE_LOGIN_LINK',
    'HEADER_MOBILE_LINK',
    'HEADER_MOBILE_LISTING_LINK',
    'HEADER_MOBILE_STORE_LOGIN_LINK',
  ]) {
    expect(styles).toContain(`export const ${name} =`);
    expect(header).toContain(`className={${name}}`);
    expect(searchHeader).toContain(`className={${name}}`);
  }
});

it('共通の値は 12px 以上の文字・44px のタップ領域（店舗ログイン・スマホのメニュー）', () => {
  expect(styles).not.toMatch(/text-(micro|tiny)\b|text-\[(\d|1[01])px\]/);
  for (const name of ['HEADER_STORE_LOGIN_LINK', 'HEADER_MOBILE_LINK', 'HEADER_MOBILE_LISTING_LINK', 'HEADER_MOBILE_STORE_LOGIN_LINK']) {
    expect(styles).toMatch(new RegExp(`export const ${name} =\\s*'[^']*\\bmin-h-11\\b`));
  }
});
