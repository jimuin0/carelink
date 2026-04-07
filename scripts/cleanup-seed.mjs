// CareLink: シードデータ一括削除スクリプト
// -------------------------------------------------------------
// 実行方法（プロジェクトルートで）:
//   node --env-file=.env.local scripts/cleanup-seed.mjs
//
// 動作:
//   - facility_profiles.is_seed = true の施設を全削除
//   - 子テーブル（facility_jobs / facility_menus / facility_photos）は
//     ON DELETE CASCADE で自動削除されます
//   - 既存の実3施設（is_seed=false）は無傷
// -------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // 件数事前確認
  const { count: before, error: countErr } = await supabase
    .from('facility_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_seed', true);

  if (countErr) {
    console.error('❌ 件数取得失敗:', countErr.message);
    process.exit(1);
  }

  console.log(`🗑  is_seed=true の施設 ${before}件 を削除します...`);

  const { error } = await supabase
    .from('facility_profiles')
    .delete()
    .eq('is_seed', true);

  if (error) {
    console.error('❌ 削除失敗:', error.message);
    process.exit(1);
  }

  console.log(`✅ 完了: ${before}件の施設および紐づく求人/メニュー/写真を削除しました`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
