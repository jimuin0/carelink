// CareLink: 都道府県ページ用ダミー施設・求人 一括生成スクリプト
// -------------------------------------------------------------
// 実行方法（プロジェクトルートで）:
//   node --env-file=.env.local scripts/seed-facilities.mjs
//
// 必須環境変数:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// 動作:
//   - 47都道府県 × 6施設 = 282施設を facility_profiles に INSERT
//   - business_type は medical / welfare / beauty を均等配分
//     （CareLinkの実際の業種スラッグ8種に展開）
//   - 各施設に 1〜3件の求人を facility_jobs に INSERT
//   - すべて is_seed=true でフラグ管理 → cleanup-seed.mjs で一括削除可
//   - 既存3施設は is_seed=false のまま無傷
//   - slug は seed-{prefSlug}-{n} で衝突回避（ユニーク制約）
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

// ============================================================
// マスタデータ
// ============================================================
const PREFECTURES = [
  ['hokkaido', '北海道', '札幌市'], ['aomori', '青森県', '青森市'], ['iwate', '岩手県', '盛岡市'],
  ['miyagi', '宮城県', '仙台市'], ['akita', '秋田県', '秋田市'], ['yamagata', '山形県', '山形市'],
  ['fukushima', '福島県', '福島市'], ['ibaraki', '茨城県', '水戸市'], ['tochigi', '栃木県', '宇都宮市'],
  ['gunma', '群馬県', '前橋市'], ['saitama', '埼玉県', 'さいたま市'], ['chiba', '千葉県', '千葉市'],
  ['tokyo', '東京都', '渋谷区'], ['kanagawa', '神奈川県', '横浜市'], ['niigata', '新潟県', '新潟市'],
  ['toyama', '富山県', '富山市'], ['ishikawa', '石川県', '金沢市'], ['fukui', '福井県', '福井市'],
  ['yamanashi', '山梨県', '甲府市'], ['nagano', '長野県', '長野市'], ['gifu', '岐阜県', '岐阜市'],
  ['shizuoka', '静岡県', '静岡市'], ['aichi', '愛知県', '名古屋市'], ['mie', '三重県', '津市'],
  ['shiga', '滋賀県', '大津市'], ['kyoto', '京都府', '京都市'], ['osaka', '大阪府', '大阪市'],
  ['hyogo', '兵庫県', '神戸市'], ['nara', '奈良県', '奈良市'], ['wakayama', '和歌山県', '和歌山市'],
  ['tottori', '鳥取県', '鳥取市'], ['shimane', '島根県', '松江市'], ['okayama', '岡山県', '岡山市'],
  ['hiroshima', '広島県', '広島市'], ['yamaguchi', '山口県', '山口市'], ['tokushima', '徳島県', '徳島市'],
  ['kagawa', '香川県', '高松市'], ['ehime', '愛媛県', '松山市'], ['kochi', '高知県', '高知市'],
  ['fukuoka', '福岡県', '福岡市'], ['saga', '佐賀県', '佐賀市'], ['nagasaki', '長崎県', '長崎市'],
  ['kumamoto', '熊本県', '熊本市'], ['oita', '大分県', '大分市'], ['miyazaki', '宮崎県', '宮崎市'],
  ['kagoshima', '鹿児島県', '鹿児島市'], ['okinawa', '沖縄県', '那覇市'],
];

// カテゴリ → CareLinkのbusiness_type値（DBで使われている表記）
const BUSINESS_TYPES = [
  // 美容
  { type: 'hair-salon', category: 'beauty', namePool: ['ヘアサロン', 'Hair Salon', 'ビューティ'], jobs: ['美容師', 'スタイリスト', 'アシスタント'] },
  { type: 'nail-eyelash', category: 'beauty', namePool: ['ネイル&アイ', 'Lash Studio', 'Nail Room'], jobs: ['ネイリスト', 'アイリスト'] },
  { type: 'esthetic', category: 'beauty', namePool: ['エステ', 'Beauty Salon', 'リフレ'], jobs: ['エステティシャン'] },
  { type: 'relaxation', category: 'beauty', namePool: ['リラク', 'Relax House', 'ボディケア'], jobs: ['セラピスト'] },
  // 医療
  { type: 'beauty-clinic', category: 'medical', namePool: ['美容クリニック', 'スキンクリニック', 'メディカルビューティ'], jobs: ['看護師', '受付'] },
  { type: 'acupuncture', category: 'medical', namePool: ['鍼灸院', '整骨院', '接骨院'], jobs: ['鍼灸師', '柔道整復師', '受付'] },
  // 福祉
  { type: 'care-service', category: 'welfare', namePool: ['デイサービス', '介護センター', 'ケアホーム'], jobs: ['介護士', 'ケアマネージャー', '生活相談員'] },
  { type: 'other', category: 'welfare', namePool: ['訪問ステーション', 'ヘルスケア', 'サポートセンター'], jobs: ['訪問介護員', '看護助手'] },
];

const FEATURES_POOL = ['駐車場あり', '駅近', '個室あり', 'カード決済可', '予約優先', 'キッズスペース', '深夜営業'];
const EMPLOYMENT_TYPES = ['正社員', 'アルバイト・パート', '業務委託', '契約社員'];

// ============================================================
// ユーティリティ
// ============================================================
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const phone = () => `0${1 + rand(9)}-${1000 + rand(9000)}-${1000 + rand(9000)}`;
const postal = () => `${100 + rand(900)}-${1000 + rand(9000)}`;

// Unsplashの安定したID（美容/医療/福祉系の汎用写真）
const PHOTO_IDS = [
  'photo-1560066984-138dadb4c035', // 美容室
  'photo-1522337360788-8b13dee7a37e', // ネイル
  'photo-1519415943484-9fa1873496d4', // エステ
  'photo-1540555700478-4be289fbecef', // クリニック
  'photo-1576091160550-2173dba999ef', // 医療
  'photo-1558960214-f4283a743867', // 介護
];
const photoUrl = () => `https://images.unsplash.com/${pick(PHOTO_IDS)}?w=800&q=80`;

// ============================================================
// 生成
// ============================================================
function buildFacility(prefSlug, prefName, city, idx) {
  const bt = BUSINESS_TYPES[idx % BUSINESS_TYPES.length];
  const name = `${pick(bt.namePool)} ${city}${idx + 1}号店`;
  const slug = `seed-${prefSlug}-${idx + 1}-${Date.now().toString(36)}-${rand(99999).toString(36)}`;
  return {
    profile: {
      name,
      slug,
      business_type: bt.type,
      catch_copy: `${prefName}・${city}で人気の${pick(bt.namePool)}`,
      description: `${prefName}${city}にある${name}です。地域密着で多くのお客様にご利用いただいています。`,
      postal_code: postal(),
      prefecture: prefName,
      city,
      address: `${prefName}${city}本町${1 + rand(9)}-${1 + rand(20)}-${1 + rand(20)}`,
      access_info: `最寄り駅から徒歩${1 + rand(15)}分`,
      phone: phone(),
      business_hours: { mon: '10:00-20:00', tue: '10:00-20:00', wed: 'closed', thu: '10:00-20:00', fri: '10:00-20:00', sat: '09:00-19:00', sun: '09:00-19:00' },
      regular_holiday: '水曜日',
      seat_count: 4 + rand(12),
      staff_count: 3 + rand(10),
      parking: Math.random() < 0.5,
      credit_card: Math.random() < 0.7,
      features: pickN(FEATURES_POOL, 2 + rand(3)),
      rating_avg: (3.5 + Math.random() * 1.4).toFixed(1),
      rating_count: 5 + rand(200),
      main_photo_url: photoUrl(),
      status: 'published',
      is_seed: true,
    },
    jobsBuilder: (facilityId) => {
      const count = 1 + rand(3);
      return Array.from({ length: count }).map(() => {
        const jobName = pick(bt.jobs);
        const min = 1800 + rand(15) * 100;
        return {
          facility_id: facilityId,
          title: `【${prefName}${city}】${jobName}募集`,
          job_type: jobName,
          employment_type: pick(EMPLOYMENT_TYPES),
          salary_min: min * 1000,
          salary_max: (min + 5 + rand(15)) * 1000,
          salary_note: '経験・能力により優遇',
          description: `${name}で${jobName}を募集しています。アットホームな職場です。`,
          requirements: '未経験可・有資格者歓迎',
          benefits: '社保完備 / 交通費支給 / 研修制度あり',
          is_seed: true,
        };
      });
    },
  };
}

// ============================================================
// メイン
// ============================================================
async function main() {
  const PER_PREFECTURE = 6; // 47 * 6 = 282施設
  console.log(`🌱 ${PREFECTURES.length}都道府県 × ${PER_PREFECTURE}施設 を生成します...`);

  let totalFacilities = 0;
  let totalJobs = 0;

  for (const [prefSlug, prefName, city] of PREFECTURES) {
    const built = Array.from({ length: PER_PREFECTURE }).map((_, i) =>
      buildFacility(prefSlug, prefName, city, i)
    );
    const profilesPayload = built.map((b) => b.profile);

    const { data: inserted, error } = await supabase
      .from('facility_profiles')
      .insert(profilesPayload)
      .select('id, slug');

    if (error) {
      console.error(`❌ ${prefName} INSERT失敗:`, error.message);
      continue;
    }

    // 求人データを生成
    const jobsPayload = [];
    inserted.forEach((row, idx) => {
      jobsPayload.push(...built[idx].jobsBuilder(row.id));
    });

    if (jobsPayload.length > 0) {
      const { error: jobErr } = await supabase.from('facility_jobs').insert(jobsPayload);
      if (jobErr) {
        console.error(`⚠️ ${prefName} 求人INSERT失敗:`, jobErr.message);
      } else {
        totalJobs += jobsPayload.length;
      }
    }

    totalFacilities += inserted.length;
    console.log(`  ✓ ${prefName}: ${inserted.length}施設 / ${jobsPayload.length}求人`);
  }

  console.log(`\n✅ 完了: 施設 ${totalFacilities}件 / 求人 ${totalJobs}件 を投入しました`);
  console.log('💡 削除する場合: node --env-file=.env.local scripts/cleanup-seed.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
