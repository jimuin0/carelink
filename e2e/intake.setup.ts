// 来院者（ゲスト）の問診票回答 E2E のセットアップ。
// CI の隔離 Supabase（supabase start の一時 DB）に service role で「公開施設＋有効な問診テンプレート」を
// seed する（本番不可侵）。テンプレートは facility_id のみ指定＝fields は DEFAULT '[]'（質問ゼロ）で、
// フォームは customer_name のみ必須になる最小構成にする。intake.spec.ts は認証なし（ゲスト）で
// /intake/{slug} に回答を送信する。
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { INTAKE_FACILITY_FILE } from './intake.fixtures';

// supabase-js v2 は Node 20 で createClient 時に WebSocket を要求し throw する。realtime 非接続のためダミー。
if (!globalThis.WebSocket) {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {};
}

setup('seed facility with active intake template', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('intake.setup: SUPABASE env 未設定（CI の supabase start 由来）');
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const ts = `${Date.now()}`;
  const slug = `e2e-intake-${ts}`;

  // 公開施設
  const { data: fac, error: fe } = await sb.from('facility_profiles').insert({
    name: `E2E問診店舗_${ts}`, slug, business_type: 'hair_salon',
    prefecture: '東京都', city: 'テスト市', address: 'テスト1-1-1', status: 'published',
  }).select('id').single();
  if (fe) throw new Error('seed facility: ' + fe.message);

  // 有効な問診テンプレート（facility_id のみ＝title/fields/is_active は DEFAULT）。
  // fields='[]' で質問ゼロ→フォームは customer_name のみ必須の最小構成になる。
  const { error: te } = await sb.from('intake_form_templates').insert({ facility_id: fac.id });
  if (te) throw new Error('seed intake template: ' + te.message);

  fs.mkdirSync(path.dirname(INTAKE_FACILITY_FILE), { recursive: true });
  fs.writeFileSync(INTAKE_FACILITY_FILE, JSON.stringify({ slug }));
  expect(slug).toBeTruthy();
});
