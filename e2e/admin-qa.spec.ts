// オーナーが Q&A を「回答（作成）→公開トグル→削除」できることを実行証明する。
// 質問は来院者が投稿するものなので、admin-batch.setup が seed した施設に対し service role で
// 未回答質問を1件 seed し、その後オーナー UI で回答→公開→削除まで通す。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

test('オーナーがQ&Aに回答→公開トグル→削除できる', async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('admin-qa.spec: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // admin-batch.setup が seed したオーナー施設（slug=e2e-batch-*）を特定し、その施設に未回答質問を seed。
  const { data: fac, error: fe } = await sb
    .from('facility_profiles')
    .select('id')
    .like('slug', 'e2e-batch-%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (fe || !fac) throw new Error('admin-qa.spec: admin-batch 施設が見つからない: ' + (fe?.message ?? 'no row'));

  const question = `E2E質問_${Date.now()}`;
  const { error: qe } = await sb.from('facility_qa').insert({
    facility_id: fac.id as string,
    question,
    status: 'pending',
    is_public: false,
  });
  if (qe) throw new Error('admin-qa.spec: 質問 seed 失敗: ' + qe.message);

  await page.goto('/admin/qa');
  // 該当質問のカードに限定（一意質問文でスコープ）。
  const card = page.locator('div.shadow-sm').filter({ hasText: question });
  await expect(card).toBeVisible({ timeout: 15000 });

  // 回答（作成）＝POST /api/admin/qa（answer）→ status='answered' 化。Modal で回答送信。
  await card.getByRole('button', { name: '回答する' }).click();
  await page.fill('#qa-answer', 'E2Eテスト回答です。');
  const submit = page.getByRole('button', { name: '回答を送信' });
  await submit.scrollIntoViewIfNeeded();

  // POST /api/admin/qa（回答）の成功を、4秒で自動消滅し CI では消滅後にポーリングして flake する
  // 成功トーストではなく API 応答そのもので判定する（唯一の副作用ゼロな決定的判定）。
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/qa') && !r.url().includes('action=') && r.request().method() === 'POST' && r.ok()),
    submit.press('Enter'),
  ]);
  // status='answered' 反映＝「回答済」バッジ＋公開トグルボタンが出る（永続 DOM 証拠）。
  const toPublic = card.getByRole('button', { name: '公開にする' });
  await expect(toPublic).toBeVisible({ timeout: 15000 });

  // 公開トグル（非公開→公開）＝POST /api/admin/qa?action=toggle-public。focus→Enter。
  await toPublic.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/qa') && r.url().includes('action=toggle-public') && r.request().method() === 'POST' && r.ok()),
    toPublic.press('Enter'),
  ]);
  // is_public=true 反映＝アイコンの aria-label が「非公開にする」に変わる（永続 DOM 証拠）。
  await expect(card.getByRole('button', { name: '非公開にする' })).toBeVisible({ timeout: 15000 });

  // 削除＝POST /api/admin/qa?action=delete。ConfirmDialog で確定。
  const del = card.getByRole('button', { name: '削除', exact: true });
  await del.scrollIntoViewIfNeeded();
  await del.press('Enter');
  const confirm = page.getByRole('button', { name: '削除する' });
  await confirm.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/qa') && r.url().includes('action=delete') && r.request().method() === 'POST' && r.ok()),
    confirm.press('Enter'),
  ]);
  // 一覧から消滅（削除永続化＋再読込反映＝永続 DOM 証拠）。
  await expect(page.getByText(question)).toHaveCount(0, { timeout: 15000 });
});
