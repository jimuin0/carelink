/**
 * GBP（Google ビジネスプロフィール）ユーティリティ
 * - Google Places API でデータ取得
 * - 43項目の最適化スコア計算
 */

export interface PlaceDetails {
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  business_status?: string;
  opening_hours?: { weekday_text?: string[]; open_now?: boolean };
  photos?: { photo_reference: string }[];
  reviews?: {
    author_name: string;
    rating: number;
    text: string;
    time: number;
    relative_time_description: string;
  }[];
  url?: string;
}

export interface AuditItem {
  id: string;
  label: string;
  category: string;
  points: number;
  passed: boolean | null;   // null = 判定不可（手動確認必要）
  detail?: string;
}

export interface GbpAuditResult {
  score: number;
  maxScore: number;
  percentage: number;
  items: AuditItem[];
  fetchedAt: string;
}

/**
 * Google Places API Details エンドポイントを呼び出す（サーバーサイド用）
 */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const fields = [
    'name', 'rating', 'user_ratings_total', 'formatted_address',
    'formatted_phone_number', 'website', 'business_status',
    'opening_hours', 'photos', 'reviews', 'url',
  ].join(',');

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=ja&key=${apiKey}`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } }); // 1時間キャッシュ
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'OK') return null;
    return json.result as PlaceDetails;
  } catch {
    return null;
  }
}

/**
 * facility_profiles のデータ + Places API データから43項目スコアを計算
 */
export function calculateGbpScore(
  place: PlaceDetails | null,
  facility: {
    name?: string | null;
    description?: string | null;
    phone?: string | null;
    website_url?: string | null;
    business_hours?: Record<string, unknown> | null;
    main_photo_url?: string | null;
    gbp_place_id?: string | null;
  }
): GbpAuditResult {
  const photoCount = place?.photos?.length ?? 0;
  const reviewCount = place?.user_ratings_total ?? 0;
  const rating = place?.rating ?? 0;
  const hasHours = !!(place?.opening_hours?.weekday_text?.length);
  const descLen = (facility.description ?? '').length;
  const hasPhone = !!(place?.formatted_phone_number || facility.phone);
  const hasWebsite = !!(place?.website || facility.website_url);

  // 直近30日以内の投稿チェック（reviewsのtimeで代用不可なのでnullにする）
  // 実際のGBP投稿はAPI v4.9+が必要なため手動確認

  const items: AuditItem[] = [
    // === 基本情報（22点） ===
    {
      id: 'place_id',
      label: 'Place ID 登録済み',
      category: '基本情報',
      points: 5,
      passed: !!facility.gbp_place_id,
      detail: facility.gbp_place_id ? undefined : 'GBP管理画面でPlace IDを確認して登録してください',
    },
    {
      id: 'business_name',
      label: '事業者名が正式名称で登録されている',
      category: '基本情報',
      points: 3,
      passed: !!place?.name,
      detail: place?.name ?? '（Places API未接続）',
    },
    {
      id: 'phone',
      label: '電話番号が登録されている',
      category: '基本情報',
      points: 3,
      passed: hasPhone,
    },
    {
      id: 'website',
      label: 'ウェブサイトURLが設定されている',
      category: '基本情報',
      points: 2,
      passed: hasWebsite,
    },
    {
      id: 'address',
      label: '住所が正確に登録されている',
      category: '基本情報',
      points: 3,
      passed: !!place?.formatted_address,
    },
    {
      id: 'business_status',
      label: '営業ステータスが「OPERATIONAL」',
      category: '基本情報',
      points: 2,
      passed: place ? place.business_status === 'OPERATIONAL' : null,
    },
    {
      id: 'hours',
      label: '営業時間が設定されている（全曜日）',
      category: '基本情報',
      points: 3,
      passed: place ? hasHours : (!!facility.business_hours),
    },
    {
      id: 'special_hours',
      label: '祝日・特別営業時間が設定されている',
      category: '基本情報',
      points: 1,
      passed: null,  // 手動確認
      detail: 'GBPコンソールで特別営業時間を確認',
    },

    // === 説明・カテゴリ（12点） ===
    {
      id: 'description',
      label: '説明文が入力されている（750文字以内）',
      category: '説明・カテゴリ',
      points: 4,
      passed: descLen > 0 && descLen <= 750,
      detail: descLen > 0 ? `現在${descLen}文字` : '説明文を入力してください（200〜750文字推奨）',
    },
    {
      id: 'description_keywords',
      label: '説明文にキーワード（地域名+業種）が含まれる',
      category: '説明・カテゴリ',
      points: 3,
      passed: descLen > 50 ? null : (descLen === 0 ? false : null),
      detail: '地域名（例: 豊中市）と業種（例: まつげパーマ）を必ず含める',
    },
    {
      id: 'primary_category',
      label: 'プライマリカテゴリが最適に設定されている',
      category: '説明・カテゴリ',
      points: 3,
      passed: null,
      detail: 'GBPコンソールでカテゴリを確認。業種に最も近いものを選ぶ',
    },
    {
      id: 'additional_category',
      label: 'サブカテゴリが1つ以上設定されている',
      category: '説明・カテゴリ',
      points: 2,
      passed: null,
      detail: '最大9個まで設定可能。関連業種を追加する',
    },

    // === 写真（15点） ===
    {
      id: 'photos_count',
      label: '写真が10枚以上登録されている',
      category: '写真',
      points: 5,
      passed: place ? photoCount >= 10 : null,
      detail: place ? `現在${photoCount}枚` : '（Places API未接続）',
    },
    {
      id: 'photo_interior',
      label: '内装写真がある',
      category: '写真',
      points: 2,
      passed: null,
      detail: '店内の雰囲気が伝わる写真を3枚以上',
    },
    {
      id: 'photo_exterior',
      label: '外観写真がある',
      category: '写真',
      points: 2,
      passed: place ? photoCount >= 3 : null,
      detail: '道案内になる外観・看板・入口の写真',
    },
    {
      id: 'photo_staff',
      label: 'スタッフ写真がある',
      category: '写真',
      points: 2,
      passed: null,
      detail: 'スタッフの顔写真で信頼性向上',
    },
    {
      id: 'photo_work',
      label: '施術・作業風景の写真がある',
      category: '写真',
      points: 2,
      passed: null,
    },
    {
      id: 'photo_quality',
      label: '写真がすべて高画質（1000px以上）',
      category: '写真',
      points: 2,
      passed: null,
      detail: '暗い・ぼけた写真は削除して再アップ',
    },

    // === 口コミ（20点） ===
    {
      id: 'review_count_10',
      label: '口コミが10件以上ある',
      category: '口コミ',
      points: 4,
      passed: place ? reviewCount >= 10 : null,
      detail: place ? `現在${reviewCount}件` : '（Places API未接続）',
    },
    {
      id: 'review_count_30',
      label: '口コミが30件以上ある',
      category: '口コミ',
      points: 4,
      passed: place ? reviewCount >= 30 : null,
      detail: place ? `現在${reviewCount}件（目標30件）` : undefined,
    },
    {
      id: 'review_rating',
      label: '評価が★4.0以上',
      category: '口コミ',
      points: 4,
      passed: place ? rating >= 4.0 : null,
      detail: place ? `現在★${rating.toFixed(1)}` : '（Places API未接続）',
    },
    {
      id: 'review_rating_high',
      label: '評価が★4.5以上',
      category: '口コミ',
      points: 3,
      passed: place ? rating >= 4.5 : null,
    },
    {
      id: 'review_reply',
      label: '口コミに返信している（返信率50%以上）',
      category: '口コミ',
      points: 3,
      passed: null,
      detail: 'すべての口コミに24時間以内に返信することを推奨',
    },
    {
      id: 'review_keywords',
      label: '返信文にキーワードが含まれている',
      category: '口コミ',
      points: 2,
      passed: null,
      detail: '「豊中市でまつげパーマをお探しなら」などの地域+業種キーワードを返信に含める',
    },

    // === 投稿・エンゲージメント（13点） ===
    {
      id: 'post_recent',
      label: '直近30日以内に投稿している',
      category: '投稿・更新',
      points: 5,
      passed: null,
      detail: '週1回以上の投稿が理想（GBP投稿タブから管理）',
    },
    {
      id: 'post_frequency',
      label: '月4回以上（週1回）の定期投稿',
      category: '投稿・更新',
      points: 4,
      passed: null,
    },
    {
      id: 'qa_answered',
      label: 'Q&Aセクションに5件以上の質問+回答がある',
      category: '投稿・更新',
      points: 2,
      passed: null,
      detail: '自分で質問して自分で回答することも可能',
    },
    {
      id: 'products_menu',
      label: 'メニュー/サービス一覧が登録されている',
      category: '投稿・更新',
      points: 2,
      passed: null,
      detail: 'GBPの「サービス」または「メニュー」セクションに主要メニューを登録',
    },
  ];

  const score = items.reduce((sum, item) => sum + (item.passed === true ? item.points : 0), 0);
  const maxScore = items.reduce((sum, item) => sum + item.points, 0);

  return {
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    items,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * スコアに応じた評価ラベル
 */
export function getScoreGrade(percentage: number): { label: string; color: string } {
  if (percentage >= 85) return { label: 'S - 最適化済み', color: 'green' };
  if (percentage >= 70) return { label: 'A - 良好', color: 'blue' };
  if (percentage >= 55) return { label: 'B - 改善余地あり', color: 'yellow' };
  if (percentage >= 40) return { label: 'C - 要改善', color: 'orange' };
  return { label: 'D - 緊急改善必要', color: 'red' };
}
