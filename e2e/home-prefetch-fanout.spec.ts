import { test, expect } from '@playwright/test';

/**
 * トップページの「先読みの扇状展開」に上限を掛ける。
 *
 * why（実測・2026年8月14日）:
 *   Next.js 16 は viewport に入った `<Link>` について【動的ルートのデータまで】先読みする。
 *   15.5 系は同じ画面で 1 本も出していなかった。同一コード・同一データで Next の版だけを
 *   入れ替えた計測（`/` の load イベント以降に開始した通信）:
 *
 *     Next 15.5.23 → 0 本
 *     Next 16.3.0  → 85 本（うち RSC ページ先読み 約20本）
 *
 *   CareLink のトップは業種・地方・47都道府県・主要都市・こだわり条件と「数で広がる」導線を
 *   持つため、この既定値だと **表示しただけで** `/search`（ビルド出力 `ƒ` ＝オンデマンド SSR）の
 *   検索レンダリングが十数回走る。実 DB クエリを伴うので閲覧 1 回あたりのサーバ負荷が桁で増える。
 *   `src/components/BrowseLink.tsx` で既定を先読みなしにして 0 本へ戻した。
 *
 * why この形にしたか:
 *   「どのリンクに prefetch={false} を書いたか」を数え上げる検査は、次に足される一覧を守らない
 *   （CLAUDE.md『発火源/対象を列挙して塞ぐ対処は必ず漏れる』）。ここでは個々のリンクを見ず、
 *   **トップ全体で何本のページ先読みが出たか**という外形だけを見る。新しい一覧を足して先読みが
 *   復活すれば、その一覧が何であってもここが赤くなる。
 *
 * when（落ちたとき）:
 *   「先読みが必要な導線を足した」のか「一覧に既定の先読みが復活した」のかを必ず区別すること。
 *   前者なら上限を上げてよい。後者は本番の関数実行数と DB クエリが増えているので直すこと。
 */

// 実測（2026年8月14日・Next 16.3.0）: 修正後 4 本 / 修正前 20 本。
// 4 と 20 の間に置く。一覧が既定の先読みに戻ると 1 つ足すだけで 5〜47 本増えるため、
// 8 でも「一覧の復活」は確実に捕まえる。逆に高意図の導線（登録 CTA・ログイン）を
// 1〜2 本足した程度では鳴らないので、通常の開発で誤報しない。
const MAX_PAGE_PREFETCHES = 8;

test('トップページが大量のページ先読みを発生させない', async ({ page }) => {
  // origin は goto 後の実 URL から取る（設定の private フィールドを覗かない）。
  // loadDone が立つのは goto 完了後なので、判定時には必ず確定している。
  let origin = '';

  let loadDone = false;
  const pagePrefetches: string[] = [];
  let anyRequestSeen = 0;

  page.on('request', (req) => {
    anyRequestSeen++;
    if (!loadDone) return;
    if (!req.url().startsWith(origin)) return;
    if (req.url().includes('/_next/static/')) return;
    // Next の RSC 先読みは RSC ヘッダか _rsc クエリを伴う。ページ遷移そのもの（document）も数える。
    const isRsc = Boolean(req.headers()['rsc']) || req.url().includes('_rsc=');
    if (isRsc || req.resourceType() === 'document') pagePrefetches.push(req.url());
  });

  await page.goto('/', { waitUntil: 'load' });
  origin = new URL(page.url()).origin;
  loadDone = true;

  // 先読み対象が最も多いのは下部の一覧。描画されるまで待ってから数える
  // （描画前に数えると「0 本だから合格」という空振りになる）。
  await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(3000);

  // 空振り防止 1: 計測機構が生きていること（静的資産だけでも必ず何本かは通る）。
  expect(anyRequestSeen, '計測機構が 1 本も要求を観測していない＝この検査は無効').toBeGreaterThan(10);

  // 空振り防止 2: 先読み対象になり得るリンクが実在すること。
  // 一覧が描画されていない状態で「先読み 0 本」を合格にしない。
  const linkCount = await page.locator('a[href]').count();
  expect(linkCount, 'トップに一覧リンクが描画されていない＝先読み 0 本は無意味').toBeGreaterThan(50);

  expect(
    pagePrefetches.length,
    `ページ先読みが多すぎる（${pagePrefetches.length} 本）。一覧リンクに既定の先読みが復活した可能性がある。` +
      `先頭: ${pagePrefetches.slice(0, 8).join(', ')}`,
  ).toBeLessThanOrEqual(MAX_PAGE_PREFETCHES);
});
