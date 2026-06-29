// 来院者（ゲスト）の施設レビュー投稿 E2E のセットアップ。
// CI の隔離 Supabase に公開施設（＋メニュー）を service role で seed する（本番不可侵）。
// review.spec.ts は認証なし（ゲスト）で /facility/{slug} の口コミタブから投稿する。
// レビュー API は user 任意（匿名は reviewer_ip で識別）のためログイン不要。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { REVIEW_FACILITY_FILE } from './review.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('seed published facility for review', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('review.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const slug = `e2e-review-${ts}`;

  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E口コミ店舗_${ts}`, slug, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);

  // 施設詳細ページが十分に描画されるようメニューを1件 seed（is_published 明示）。
  const { error: me } = await sb.from('facility_menus').insert({
    facility_id: fac.id, category: 'カット', name: 'E2E口コミメニュー', price: 5000, duration_minutes: 60, is_published: true,
  });
  if (me) throw new Error('seed menu: ' + me.message);

  fs.mkdirSync(path.dirname(REVIEW_FACILITY_FILE), { recursive: true });
  fs.writeFileSync(REVIEW_FACILITY_FILE, JSON.stringify({ slug }));
  expect(slug).toBeTruthy();
});
