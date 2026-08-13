// 子ルート（/admin/jobs/new）から親の一覧（/admin/jobs）へ戻るクライアント遷移が、
// 一覧の RSC ペイロードが大きくても成立することを実行証明する。
//
// 🔴 why(2026-08-13 実測): Next.js 15.5 系には「子→親のクライアント遷移が、その画面の
//   RSC ペイロードが約 29KB を超えると【無音で成立しなくなる】」不具合がある。
//   URL も画面内容も変わらず、JS エラーも出ない。ユーザーには「押しても何も起きない」
//   としか見えない。Next 16.3.0 で解消することを A/B/A 対照で確認した
//   （15.5.21 / 15.5.23 で再現、16.3.0 で解消。閾値は 28,687B 成功 / 30,641B 失敗を二分探索で実測）。
//
// 【この spec が要る理由】既存の admin-jobs.spec.ts は求人を 1 件だけ作って遷移するため、
//   ペイロードが閾値の下に収まり **不具合があっても通ってしまう回がある**（実際 CI で
//   3 回中 1 回だけ通り、原因究明を遅らせた）。ここでは意図的に閾値を大きく超えるデータを
//   seed し、**決定的に**検出できるようにする。
//
// 【ガードとしての性質】ペイロードが本当に閾値を超えていることを測ってから遷移を検証する。
//   データ件数が変わっても「超えていなければテスト自体を失敗させる」ので、
//   seed が効かなくなった時に緑のまま素通りしない（空振り防止）。
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する（他 setup と同型）。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

// 不具合が発症していた実測閾値（30,641B で失敗）より十分に大きい値を要求する。
// 「閾値ぎりぎり」だと将来わずかな描画変更で下回り、検出力を失う。
const REQUIRED_PAYLOAD_BYTES = 45_000;

test.setTimeout(120_000);

test('一覧が大きくても新規作成画面から一覧へ戻れる（子→親のクライアント遷移）', async ({ page }) => {
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

  // ペイロードを膨らませる。文章列（description/requirements/benefits）が実データでも
  // 支配的なので、それらを埋めた行を入れる。
  const filler = 'あ'.repeat(300);
  const rows = Array.from({ length: 40 }, (_, i) => ({
    facility_id: facilityId,
    title: `E2E大量求人_${i}_${Date.now()}`,
    job_type: '美容師',
    employment_type: '正社員',
    description: filler,
    requirements: filler,
    benefits: filler,
  }));
  const { error: ie } = await sb.from('facility_jobs').insert(rows);
  if (ie) throw new Error(`admin-large-list-nav: seed 失敗: ${ie.message}`);

  await page.goto('/admin/jobs/new');
  await expect(page.getByRole('heading', { name: '求人新規作成' })).toBeVisible();

  // 🔴 空振り防止: 一覧の RSC ペイロードが本当に閾値を超えているかを測る。
  //   超えていなければ、このテストは不具合を検出できない状態なので失敗させる。
  const payloadBytes = await page.evaluate(async () => {
    const res = await fetch('/admin/jobs?_rsc=e2eprobe', { headers: { RSC: '1' } });
    return (await res.text()).length;
  });
  expect(
    { payloadBytes, enough: payloadBytes >= REQUIRED_PAYLOAD_BYTES },
    `一覧の RSC ペイロードが ${REQUIRED_PAYLOAD_BYTES}B に満たない（${payloadBytes}B）。` +
      ' seed が効いていないか描画が変わった。この状態では不具合を検出できないため失敗させる。',
  ).toEqual({ payloadBytes, enough: true });

  // 本題: サイドナビの一覧リンク（<Link>＝クライアント遷移）で親へ戻れること。
  // 不具合下では URL も画面も変わらず、ここで待ち続けてタイムアウトする。
  const toList = page.locator('a[href="/admin/jobs"]').first();
  await expect(toList).toBeVisible();
  await toList.click();
  await page.waitForURL('**/admin/jobs', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: '求人管理' })).toBeVisible();
});
