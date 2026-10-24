import type { SupabaseClient } from '@supabase/supabase-js';
import { businessTypes } from './constants';
import { medicalBusinessTypes } from './medical-business-types';

/**
 * 管理画面の入力欄に出す、業種ごとの候補・入力例。業種の保存値（facility_profiles.business_type）の
 * 単一ソースは constants.ts の businessTypes で、ここはそのキーごとの文言だけを持つ。
 *
 * 以前はメニューのカテゴリが美容室向けの固定リスト（既定「カット」）、スタッフの入力例が
 * 「スタイリスト」「カット, カラー, パーマ」で、鍼灸院やピラティスの店舗にも美容室の言葉を出していた。
 * 候補はあくまで候補で、入力は自由（既存のカテゴリ名はそのまま有効）。
 *
 * src/lib/__tests__/business-type-copy.test.ts が、businessTypes の全業種に文言があることを固定する
 * （業種を足したのにここを書き忘れると、汎用の文言に黙って落ちるため）。
 */
export interface BusinessTypeCopy {
  /** メニューのカテゴリ候補（先頭が新規メニューの既定値）。 */
  menuCategories: readonly string[];
  /** スタッフの役職の入力例。 */
  positionExample: string;
  /** スタッフの得意分野の入力例（読点区切り）。 */
  specialtiesExample: string;
  /**
   * 医療広告ガイドライン・あはき法の広告制限の注意を出すか。医療機関（美容クリニック）と
   * 鍼灸・柔道整復（鍼灸院・整骨院）が対象。業種が分からないとき（未設定・読めない・その他）は
   * 出す側に倒す（対象の店舗に出し忘れるより、対象外の店舗に出るほうが害が小さい）。
   */
  medicalAdNotice: boolean;
}

export const BUSINESS_TYPE_COPY: Readonly<Record<string, BusinessTypeCopy>> = {
  ...Object.fromEntries(medicalBusinessTypes.map(type => [type, {
    menuCategories: ['一般診療', '検査', '予防接種', '健診', 'その他'],
    positionExample: '院長、医師、歯科医師、看護師、スタッフ等',
    specialtiesExample: type,
    medicalAdNotice: true,
  }])),
  'ヘアサロン': {
    menuCategories: ['カット', 'カラー', 'パーマ', '縮毛矯正', 'トリートメント', 'ヘッドスパ', 'セット', 'エクステ', 'その他'],
    positionExample: '店長、スタイリスト、アシスタント等',
    specialtiesExample: 'カット、カラー、パーマ',
    medicalAdNotice: false,
  },
  'ネイル・まつげサロン': {
    menuCategories: ['ハンドネイル', 'フットネイル', 'ネイルケア', 'オフ', 'まつげエクステ', 'まつげパーマ', 'アイブロウ', 'その他'],
    positionExample: '店長、ネイリスト、アイリスト等',
    specialtiesExample: 'ジェルネイル、まつげパーマ',
    medicalAdNotice: false,
  },
  'リラクサロン': {
    menuCategories: ['ボディケア', 'フットケア', 'ヘッドケア', 'アロマ', 'リフレクソロジー', 'その他'],
    positionExample: '店長、セラピスト等',
    specialtiesExample: 'ボディケア、アロマ',
    medicalAdNotice: false,
  },
  'エステサロン': {
    menuCategories: ['フェイシャル', 'ボディ', '痩身', '脱毛', 'ブライダル', 'その他'],
    positionExample: '店長、エステティシャン等',
    specialtiesExample: 'フェイシャル、痩身',
    medicalAdNotice: false,
  },
  '美容クリニック': {
    menuCategories: ['カウンセリング', '美容皮膚科', '医療脱毛', '注入治療', 'その他'],
    positionExample: '院長、医師、看護師、カウンセラー等',
    specialtiesExample: '美容皮膚科、医療脱毛',
    medicalAdNotice: true,
  },
  '鍼灸院・整骨院': {
    menuCategories: ['鍼灸', '整体', '骨盤調整', 'マッサージ', '保険施術', 'その他'],
    positionExample: '院長、鍼灸師、柔道整復師等',
    specialtiesExample: '鍼灸、骨盤調整',
    medicalAdNotice: true,
  },
  'ピラティス': {
    menuCategories: ['マシンピラティス', 'マットピラティス', 'パーソナル', 'グループ', '体験', 'その他'],
    positionExample: '代表、インストラクター等',
    specialtiesExample: 'マシンピラティス、姿勢改善',
    medicalAdNotice: false,
  },
  'その他': {
    menuCategories: ['基本メニュー', 'オプション', 'その他'],
    positionExample: '店長、スタッフ等',
    specialtiesExample: '得意な施術・メニュー',
    medicalAdNotice: true,
  },
};

/** 業種が分からないとき（未設定・読めない・一覧に無い値）の文言。「その他」と同じ。 */
export const FALLBACK_BUSINESS_TYPE_COPY: BusinessTypeCopy = BUSINESS_TYPE_COPY['その他'];

/** 業種の保存値 → 入力欄の文言。分からない業種は汎用の文言（医療広告の注意は出す側）。 */
export function businessTypeCopy(businessType: string | null | undefined): BusinessTypeCopy {
  if (businessType && Object.hasOwn(BUSINESS_TYPE_COPY, businessType)) return BUSINESS_TYPE_COPY[businessType];
  return FALLBACK_BUSINESS_TYPE_COPY;
}

/**
 * メニューのカテゴリ候補。業種の候補に、その店舗で既に使っているカテゴリを足す（重複なし・業種の候補が先）。
 * 既存のカテゴリを候補から落とすと、以前の選択式のときに作ったカテゴリが選べなくなって見えるため。
 */
export function menuCategorySuggestions(businessType: string | null | undefined, existing: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const category of [...businessTypeCopy(businessType).menuCategories, ...existing]) {
    const value = category.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** businessTypes（保存値の単一ソース）のうち、文言の無い業種。テストが空であることを確かめる。 */
export function businessTypesWithoutCopy(): string[] {
  return businessTypes.filter((type) => !Object.hasOwn(BUSINESS_TYPE_COPY, type));
}

/**
 * 選択中の店舗の業種を読む。入力欄の候補・注意書きにしか使わないので、読めなければ null
 * （＝汎用の文言・医療広告の注意は出す）にして画面は止めない。
 */
export async function loadFacilityBusinessType(client: SupabaseClient, facilityId: string): Promise<string | null> {
  try {
    const { data, error } = await client.from('facility_profiles').select('business_type').eq('id', facilityId).maybeSingle();
    if (error || !data) return null;
    const value = (data as { business_type?: unknown }).business_type;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
