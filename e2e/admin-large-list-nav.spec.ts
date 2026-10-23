// 子ルート（/admin/blog/new）から親の一覧（/admin/blog）へ戻るクライアント遷移が、
// 一覧の RSC ペイロードが大きくても成立することを実行証明する。
//
// 🔴 why(2026-08-13 実測): Next.js 15.5 系には「子→親のクライアント遷移が、その画面の
//   RSC ペイロードが約 29KB を超えると【無音で成立しなくなる】」不具合がある。
//   URL も画面内容も変わらず、JS エラーも出ない。ユーザーには「押しても何も起きない」
//   としか見えない。Next 16.3.0 で解消することを A/B/A 対照で確認した
//   （15.5.21 / 15.5.23 で再現、16.3.0 で解消。閾値は 28,687B 成功 / 30,641B 失敗を二分探索で実測）。
//
// 【この spec が要る理由】1 件だけ作って遷移する spec（admin-blog.spec.ts 等）は、
//   ペイロードが閾値の下に収まり **不具合があっても通ってしまう回がある**（実際 CI で
//   3 回中 1 回だけ通り、原因究明を遅らせた）。ここでは意図的に閾値を大きく超えるデータを
//   seed し、**決定的に**検出できるようにする。
//
// 【対象をブログにした理由（2026年10月23日）】以前は求人（/admin/jobs）で検証していたが、求人は
//   「今はなし」の判断で管理画面から隠され（src/lib/feature-toggles.ts の SHOW_JOBS=false）、
//   この spec ごと skip されてガードが効いていなかった。ブログは new/[id]/edit の子ルートを持つ
//   同じ構造の一覧で、機能の表示スイッチの対象外（常に表示）なので、こちらで常時検証する。
//
// 【ガードとしての性質】ペイロードが本当に閾値を超えていることを測ってから遷移を検証する。
//   データ件数が変わっても「超えていなければテスト自体を失敗させる」ので、
//   seed が効かなくなった時に緑のまま素通りしない（空振り防止）。
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// 一覧（src/app/admin/blog/page.tsx）は新しい順に最大 100 件を描く。上限いっぱいまで入れる。
const SEED_POSTS = 100;

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する（他 setup と同型）。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

// 不具合が発症していた実測閾値（30,641B で失敗）より十分に大きい値を要求する。
// 「閾値ぎりぎり」だと将来わずかな描画変更で下回り、検出力を失う。
const REQUIRED_PAYLOAD_BYTES = 45_000;

test.setTimeout(120_000);

test('ブログ一覧が大きくても新規作成画面から一覧へ戻れる（子→親のクライアント遷移）', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('admin-large-list-nav: SUPABASE env 未設定（CI の supabase start 由来）');
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // admin-batch.setup が作った施設を使う（同 setup の storageState でログイン済み）。
  const { data: fac, error: fe } = await sb
    .from('facility_profiles')
    .select('id')
    .like('slug', 'e2e-batch-%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fe || !fac) throw new Error(`admin-large-list-nav: 施設が見つからない: ${fe?.message}`);
  const facilityId = (fac as { id: string }).id;

  // ペイロードを膨らませる。一覧はサーバーで描画され、各記事の行（タイトル・編集リンク・状態）が
  // RSC ペイロードに載るので、長めのタイトルの下書きを上限件数まで入れる。
  // created_at を過去にしておくと、同じ店舗で記事を作る admin-blog.spec の新しい記事が常に先頭に来る
  // （上限 100 件から押し出さない）。下書きなので公開ページには出ない。
  const ts = Date.now();
  const titleFiller = 'い'.repeat(120);
  const rows = Array.from({ length: SEED_POSTS }, (_, i) => ({
    facility_id: facilityId,
    title: `E2E大量ブログ_${i}_${ts}_${titleFiller}`,
    slug: `e2e-large-list-${ts}-${i}`,
    content: 'E2E本文（一覧の大きさを作るための下書き）',
    is_published: false,
    created_at: new Date(Date.UTC(2020, 0, 1) + i * 1000).toISOString(),
  }));
  const { data: seeded, error: ie } = await sb.from('blog_posts').insert(rows).select('id');
  if (ie || !seeded) throw new Error(`admin-large-list-nav: seed 失敗: ${ie?.message}`);
  const seededIds = (seeded as { id: string }[]).map((row) => row.id);
  expect(seededIds).toHaveLength(SEED_POSTS);

  try {
    await page.goto('/admin/blog/new');
    await expect(page.getByRole('heading', { name: 'ブログ新規作成' })).toBeVisible();

    // 🔴 空振り防止: 一覧の RSC ペイロードが本当に閾値を超えているかを測る。
    //   超えていなければ、このテストは不具合を検出できない状態なので失敗させる。
    const payloadBytes = await page.evaluate(async () => {
      const res = await fetch('/admin/blog?_rsc=e2eprobe', { headers: { RSC: '1' } });
      return (await res.text()).length;
    });
    expect(
      { payloadBytes, enough: payloadBytes >= REQUIRED_PAYLOAD_BYTES },
      `一覧の RSC ペイロードが ${REQUIRED_PAYLOAD_BYTES}B に満たない（${payloadBytes}B）。` +
        ' seed が効いていないか描画が変わった。この状態では不具合を検出できないため失敗させる。',
    ).toEqual({ payloadBytes, enough: true });

    // 本題: 上部ナビの一覧リンク（<Link>＝クライアント遷移）で親へ戻れること。
    // 不具合下では URL も画面も変わらず、ここで待ち続けてタイムアウトする。
    const toList = page.locator('a[href="/admin/blog"]:visible').first();
    await expect(toList).toBeVisible();
    await toList.click();
    await page.waitForURL('**/admin/blog', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'ブログ管理' })).toBeVisible();
    // 空振り防止（遷移先）: 大きな一覧が実際に描かれていること（見出しだけの空の一覧で緑にしない）。
    await expect(page.getByText(`E2E大量ブログ_${SEED_POSTS - 1}_${ts}_`, { exact: false })).toBeVisible();
  } finally {
    await sb.from('blog_posts').delete().in('id', seededIds);
  }
});
