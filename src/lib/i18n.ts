/**
 * 多言語対応（i18n）基盤
 * 対象: 英語（en）、中国語簡体字（zh）、韓国語（ko）
 * インバウンド観光客向け
 */

export type Locale = 'ja' | 'en' | 'zh' | 'ko';

export const SUPPORTED_LOCALES: Locale[] = ['ja', 'en', 'zh', 'ko'];

export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
  zh: '中文',
  ko: '한국어',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  ja: '🇯🇵',
  en: '🇺🇸',
  zh: '🇨🇳',
  ko: '🇰🇷',
};

/**
 * UI翻訳辞書
 * キー: 英語(en)のキー文字列
 * 値: 各言語の翻訳
 */
const translations: Record<string, Partial<Record<Locale, string>>> = {
  'search.placeholder': {
    ja: 'エリア・業種・施設名で検索',
    en: 'Search by area, type, or name',
    zh: '按地区、类型或名称搜索',
    ko: '지역, 유형 또는 이름으로 검색',
  },
  'search.title': {
    ja: 'サロン・クリニックを探す',
    en: 'Find Salons & Clinics',
    zh: '查找沙龙和诊所',
    ko: '살롱 및 클리닉 찾기',
  },
  'booking.title': {
    ja: '予約する',
    en: 'Book Now',
    zh: '立即预约',
    ko: '예약하기',
  },
  'booking.selectDate': {
    ja: '日付を選択',
    en: 'Select Date',
    zh: '选择日期',
    ko: '날짜 선택',
  },
  'booking.selectTime': {
    ja: '時間を選択',
    en: 'Select Time',
    zh: '选择时间',
    ko: '시간 선택',
  },
  'booking.selectMenu': {
    ja: 'メニューを選択',
    en: 'Select Menu',
    zh: '选择菜单',
    ko: '메뉴 선택',
  },
  'booking.selectStaff': {
    ja: 'スタッフを選択（任意）',
    en: 'Select Staff (Optional)',
    zh: '选择员工（可选）',
    ko: '스태프 선택 (선택사항)',
  },
  'booking.confirm': {
    ja: '予約を確定する',
    en: 'Confirm Booking',
    zh: '确认预约',
    ko: '예약 확인',
  },
  'booking.success': {
    ja: '予約が完了しました',
    en: 'Booking Confirmed!',
    zh: '预约成功！',
    ko: '예약이 완료되었습니다!',
  },
  'facility.review': {
    ja: '口コミ',
    en: 'Reviews',
    zh: '评价',
    ko: '리뷰',
  },
  'facility.access': {
    ja: 'アクセス',
    en: 'Access',
    zh: '交通',
    ko: '교통',
  },
  'facility.menu': {
    ja: 'メニュー',
    en: 'Menu',
    zh: '菜单',
    ko: '메뉴',
  },
  'facility.staff': {
    ja: 'スタッフ',
    en: 'Staff',
    zh: '员工',
    ko: '스태프',
  },
  'nav.home': {
    ja: 'ホーム',
    en: 'Home',
    zh: '首页',
    ko: '홈',
  },
  'nav.search': {
    ja: '検索',
    en: 'Search',
    zh: '搜索',
    ko: '검색',
  },
  'nav.mypage': {
    ja: 'マイページ',
    en: 'My Page',
    zh: '我的页面',
    ko: '내 페이지',
  },
  'nav.login': {
    ja: 'ログイン',
    en: 'Login',
    zh: '登录',
    ko: '로그인',
  },
  'common.free': {
    ja: '無料',
    en: 'Free',
    zh: '免费',
    ko: '무료',
  },
  'common.yen': {
    ja: '円',
    en: 'JPY',
    zh: '日元',
    ko: '엔',
  },
};

/**
 * 翻訳関数
 * @param key 翻訳キー
 * @param locale 言語コード
 * @param fallback フォールバック（指定なければja）
 */
export function t(key: string, locale: Locale = 'ja', fallback?: string): string {
  const dict = translations[key];
  if (!dict) return fallback ?? key;
  return dict[locale] ?? dict.ja ?? fallback ?? key;
}

/**
 * Accept-Language ヘッダーからロケールを判定
 */
export function detectLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return 'ja';
  const preferred = acceptLanguage.split(',')[0].split('-')[0].toLowerCase();
  if (SUPPORTED_LOCALES.includes(preferred as Locale)) return preferred as Locale;
  return 'ja';
}

/**
 * ロケールをクッキーに保存するキー
 */
export const LOCALE_COOKIE_KEY = 'cl_locale';
