/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * ストック写真ガードが【配線されたまま】であること、および
 * 【ストック画像がこれ以上増えていない】ことをリポジトリ全体で機械強制する（2026年8月11日 新設）。
 *
 * 【なぜ必要か】判定関数(`src/lib/stock-image-guard.ts`)は在るだけでは何も守らない。
 * 実際に本番へストック画像が入った経路は「画像URLを受け取る入口が増えたが、そこにガードを
 * 通す発想が無かった」であって、判定ロジックの不備ではなかった。同じ形の事故は
 * 「関数が存在するか」ではなく「入口が全部通っているか」でしか止められない。
 *
 * 検査は3本:
 *   1. 画像URLフィールドを受け取る API ルートは、2つのガードのどちらかを参照している
 *   2. migration / seed / アプリコードにストック画像の URL が新たに増えていない
 *   3. next.config.mjs の images.unsplash.com 許可が残っている（先に外すと本番が壊れる）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, sep } from 'path';
import { STOCK_IMAGE_DOMAINS } from '@/lib/stock-image-guard';

const ROOT = process.cwd();

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

const isTestFile = (p: string) =>
  p.includes(`${sep}__tests__${sep}`) || /\.test\.[cm]?[jt]sx?$/.test(p);

/**
 * 実際の URL だけを拾う（`hostname: 'images.unsplash.com'` のような設定値や、経緯を説明する
 * 散文中のホスト名まで禁止すると、禁止した理由そのものを書き残せなくなる）。
 */
const STOCK_URL_RE = new RegExp(
  // スキーム直後〜ホスト末尾までを厳密に見る。前方は「ドットで終わるサブドメイン列」だけを
  // 許すので notunsplash.com は一致せず、後方は区切り文字を要求するので
  // unsplash.com.evil.example のような接尾辞偽装も一致しない（下の負の対照で固定）。
  `https?://(?:[^\\s'"\`)]*\\.)?(?:${STOCK_IMAGE_DOMAINS.map((d) =>
    d.replace(/\./g, '\\.')
  ).join('|')})(?:[/'"\`\\s)]|$)`,
  'im'
);

/**
 * 既に本番へ適用済みの初期シード。migration は適用後に書き換えても本番のデータは変わらず、
 * shadow スキーマとの突合（schema-fingerprint）だけが壊れるため、ここは【触らない】のが正解。
 * 本番に残ったストック画像の差し替えは DB 側の作業であり、このリストの縮小では解決しない。
 */
const GRANDFATHERED: Record<string, string> = {
  'supabase/migrations/20260321000004_facilities_phase1.sql':
    '適用済みの初期シード。過去の migration は改変しない（本番データは変わらず突合だけが壊れるため）',
  'supabase/migrations/20260331000001_data_enrichment.sql':
    '適用済みの初期シード。同上',
  'scripts/seed-facilities.mjs':
    'ローカル/検証用の初期シードスクリプト。本番投入経路ではないが履歴として残す',
};

const GUARD_IMPORT_RE = /from\s+'@\/lib\/(?:stock-image-guard|storage-url-guard)'/;
const GUARD_CALL_RE = /\b(?:isStockImageUrl|isNewStockImage|isAllowedStorageUrl)\s*\(/;

describe('ストック写真ガードの配線', () => {
  it('画像URLフィールドを受け取る API ルートは必ずガードを参照している', () => {
    const routes = walk(join(ROOT, 'src/app/api'), (p) => p.endsWith(`${sep}route.ts`));
    expect(routes.length).toBeGreaterThan(0);

    const IMAGE_FIELD_RE = /\b(?:image_url|image_urls|photo_url|photo_urls|thumbnail_url)\s*:\s*z\./;
    const unguarded: string[] = [];
    let inspected = 0;

    for (const file of routes) {
      const src = readFileSync(file, 'utf8');
      if (!IMAGE_FIELD_RE.test(src)) continue;
      inspected++;
      // stock-image-guard  … 任意の https URL を受け付ける入口（新規ストック画像を拒否）
      // storage-url-guard  … 自 Supabase Storage の公開プレフィックス限定（外部ホスト自体が不可）
      //
      // import と「実際の呼び出し」の両方を要求する。文字列包含だけで見ていると、
      // 配線を外してもコメント中の `src/lib/stock-image-guard.ts` という言及で緑になる
      // （実際にこの検査を敵対テストしたとき、まさにそれで見逃した）。
      const imported = GUARD_IMPORT_RE.test(src);
      const called = GUARD_CALL_RE.test(src);
      if (!imported || !called) unguarded.push(relative(ROOT, file));
    }

    // 負の対照: 検査対象が 0 本なら、この検査は何も守っていない（正規表現の腐りを緑にしない）。
    expect(inspected).toBeGreaterThanOrEqual(4);
    expect(unguarded).toEqual([]);
  });
});

describe('ストック画像がこれ以上増えていない', () => {
  it('URL 検出の正規表現が実際に機能する（負の対照）', () => {
    expect(STOCK_URL_RE.test("'https://images.unsplash.com/photo-1560066984?w=800'")).toBe(true);
    expect(STOCK_URL_RE.test('https://unsplash.com/photos/abc ')).toBe(true);
    // 設定値・散文中のホスト名は対象外（禁止理由を書き残せるようにするため）
    expect(STOCK_URL_RE.test("hostname: 'images.unsplash.com',")).toBe(false);
    // 別ホストの誤検知が無いこと
    expect(STOCK_URL_RE.test('https://notunsplash.com/x.jpg ')).toBe(false);
  });

  it('許可リストの各エントリに理由が書かれている', () => {
    for (const [file, reason] of Object.entries(GRANDFATHERED)) {
      expect(existsSync(join(ROOT, file))).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('許可リスト以外にストック画像の URL が存在しない', () => {
    const files = [
      ...walk(join(ROOT, 'supabase/migrations'), (p) => p.endsWith('.sql')),
      ...walk(join(ROOT, 'scripts'), (p) => /\.[cm]?[jt]s$/.test(p)),
      ...walk(join(ROOT, 'src'), (p) => /\.[jt]sx?$/.test(p) && !isTestFile(p)),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .map((f) => relative(ROOT, f).split(sep).join('/'))
      .filter((rel) => !(rel in GRANDFATHERED))
      .filter((rel) => STOCK_URL_RE.test(readFileSync(join(ROOT, rel), 'utf8')));

    expect(offenders).toEqual([]);
  });
});

/**
 * 【撤去の順序】本番 DB に残るストック画像（施設写真・特集記事・ブログ）を差し替える前に
 * remotePatterns から images.unsplash.com を外すと、既存画像が next/image で 400 になり
 * /search・/ranking の表示が壊れる（2026年7月5日に実機で発生済み）。
 * 差し替えが完了したら、この検査ごと削除して remotePatterns からも外すこと。
 */
it('本番データの差し替えが済むまで images.unsplash.com の許可を外さない', () => {
  const cfg = readFileSync(join(ROOT, 'next.config.mjs'), 'utf8');
  expect(cfg).toContain('images.unsplash.com');
});
