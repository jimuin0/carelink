import { test, expect, devices, type Locator, type Page } from '@playwright/test';

/**
 * スマホ（iPhone 13 の画面）で、画面下部の固定バーが他の操作を覆わないこと（2026年10月22日）。
 *
 * 本番では次の 3 つが実測で起きていた。
 * - 一番下までスクロールしても、フッター最終行の「プライバシーポリシー／利用規約／
 *   特定商取引法に基づく表記」が下部ナビの下に隠れ、押すとナビ（ホーム・検索…）が開いた。
 *   特商法表記へはフッターからしか行けないので、スマホからは開けなかった。
 * - トップの会員登録 CTA が下部ナビと Cookie 同意バナーの「必須のみ／すべて同意」を覆っていた。
 * - 絞り込みドロワーで「この条件で検索」「クリア」を押しても閉じず、反応が無いように見えた。
 *
 * 「見えている」だけでは覆われていても通ってしまうので、要素の中心で elementFromPoint を引き、
 * 本当にその要素が押せる（いちばん手前にある）ことまで確かめる。
 * Mobile Safari プロジェクトでは iPhone 13 そのもの、他のプロジェクトでも同じ画面サイズで走る。
 */
test.use({ viewport: devices['iPhone 13'].viewport });

const CONSENT = JSON.stringify({ necessary: true, analytics: false, marketing: false });

async function withStoredConsent(page: Page) {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('cookie-consent-v2', value);
    } catch {
      // ストレージが使えない場合は同意バナーが出るだけ（検査側で落ちる）
    }
  }, CONSENT);
}

/** 要素の中心が画面内にあり、その点でいちばん手前にあるのが当の要素（か、その子孫）であること。 */
async function expectHittable(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          if (r.width === 0 || r.height === 0 || y < 0 || y > window.innerHeight) {
            return `画面外 (top=${Math.round(r.top)}, bottom=${Math.round(r.bottom)}, viewport=${window.innerHeight})`;
          }
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === el || el.contains(hit))) return 'ok';
          const name = hit ? `${hit.tagName.toLowerCase()} "${(hit.textContent ?? '').trim().slice(0, 20)}"` : 'なし';
          return `覆われている: ${name}`;
        }),
      { message: '要素がいちばん手前で押せること' },
    )
    .toBe('ok');
}

async function scrollToVeryBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // 遅延描画でページが伸びた場合に備え、末尾に着いたことを確かめる
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
      }),
    )
    .toBe(true);
}

async function expectFooterLegalLinksReachable(page: Page) {
  const footer = page.getByRole('contentinfo');
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  // 下部ナビは遅延読み込み。出てから測らないと「覆うものが無い」状態で緑になる
  await expect(nav).toBeVisible();
  await scrollToVeryBottom(page);
  for (const name of ['プライバシーポリシー', '利用規約', '特定商取引法に基づく表記']) {
    await expectHittable(footer.getByRole('link', { name, exact: true }));
  }
}

for (const path of ['/search', '/ranking', '/auth/login', '/auth/signup']) {
  test(`${path}: 一番下までスクロールすれば、フッターの規約リンクが下部ナビに覆われず押せる`, async ({ page }) => {
    await withStoredConsent(page);
    await page.goto(path);
    await expectFooterLegalLinksReachable(page);
  });
}

test('/: 会員登録 CTA が出ていても、下部ナビとフッターの規約リンクを覆わない', async ({ page }) => {
  await withStoredConsent(page);
  await page.goto('/');
  const cta = page.locator('[data-sticky-signup-cta]');
  // 未ログインなので CTA が出る（出ないまま測ると、覆うものが無いので空振りで緑になる）
  await expect(cta).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  await expect(nav).toBeVisible();
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));
  await expectHittable(cta.getByRole('link', { name: '無料で会員登録する' }));

  // 下半分（クライアント描画）が出てから末尾へ
  await expect(page.getByRole('heading', { name: '都道府県から探す' })).toBeAttached();
  await expectFooterLegalLinksReachable(page);
});

test('/: 初回訪問の Cookie 同意バナーは下部ナビの上に出て、ボタンが押せる（CTA はその後に出る）', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Cookieの設定' });
  await expect(banner).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
  await expect(nav).toBeVisible();

  // 同意の選択が済むまで CTA は出さない（バナーのボタンを覆っていた）
  await expect(page.locator('[data-sticky-signup-cta]')).toHaveCount(0);
  await expectHittable(banner.getByRole('button', { name: '必須のみ', exact: true }));
  await expectHittable(banner.getByRole('button', { name: 'すべて同意', exact: true }));
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));

  await banner.getByRole('button', { name: '必須のみ', exact: true }).click();
  await expect(banner).toBeHidden();
  const cta = page.locator('[data-sticky-signup-cta]');
  await expect(cta).toBeVisible();
  await expectHittable(nav.getByRole('link', { name: 'ホーム' }));
});

test('/search: 絞り込みドロワーは「この条件で検索」「クリア」で閉じる', async ({ page }) => {
  await withStoredConsent(page);
  await page.goto('/search');
  const dialog = page.locator('#mobile-filter-dialog');
  const isOpen = () => dialog.evaluate((el) => (el as HTMLDialogElement).open);
  // ドロワーはクライアント側だけで描かれる。描かれる前（ハイドレーション前）に押しても開かない
  await expect(dialog).toBeAttached();

  await page.getByRole('button', { name: '絞り込みフィルターを開く' }).click();
  await expect.poll(isOpen).toBe(true);
  await dialog.getByRole('button', { name: '当日予約OK' }).click();
  await dialog.getByRole('button', { name: 'この条件で検索' }).click();
  await expect(page).toHaveURL(/[?&]features=/);
  await expect.poll(isOpen).toBe(false);

  await page.getByRole('button', { name: '絞り込みフィルターを開く' }).click();
  await expect.poll(isOpen).toBe(true);
  await dialog.getByRole('button', { name: 'フィルターをクリア' }).click();
  await expect(page).not.toHaveURL(/features=/);
  await expect.poll(isOpen).toBe(false);
});
