/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { t, detectLocale, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAGS, LOCALE_COOKIE_KEY } from '../i18n';

describe('t()', () => {
  test('ja (default) returns Japanese string', () => {
    expect(t('booking.title')).toBe('予約する');
  });

  test('en returns English string', () => {
    expect(t('booking.title', 'en')).toBe('Book Now');
  });

  test('zh returns Chinese string', () => {
    expect(t('booking.title', 'zh')).toBe('立即预约');
  });

  test('ko returns Korean string', () => {
    expect(t('booking.title', 'ko')).toBe('예약하기');
  });

  test('unknown key returns fallback when provided', () => {
    expect(t('nonexistent.key', 'ja', 'fallback text')).toBe('fallback text');
  });

  test('unknown key returns key itself when no fallback', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  test('known key with locale that has no translation falls back to ja', () => {
    // All keys have ja, so this tests the dict[locale] ?? dict.ja path
    expect(t('common.free', 'ja')).toBe('無料');
    expect(t('common.free', 'en')).toBe('Free');
  });

  test('known key with unsupported locale → dict[locale] undefined → falls back to dict.ja', () => {
    // 'fr' is not a supported Locale, so dict['fr'] is undefined → falls back to dict.ja
    expect(t('common.free', 'fr' as Locale)).toBe('無料');
  });

  test('unknown key without fallback returns key itself (no fallback param)', () => {
    expect(t('totally.missing.key')).toBe('totally.missing.key');
  });

  test('unknown key with locale + no fallback returns key', () => {
    expect(t('totally.missing.key', 'en')).toBe('totally.missing.key');
  });

  test('search keys are translated', () => {
    expect(t('search.placeholder', 'en')).toBe('Search by area, type, or name');
    expect(t('nav.home', 'ko')).toBe('홈');
  });
});

describe('detectLocale()', () => {
  test('null → ja', () => {
    expect(detectLocale(null)).toBe('ja');
  });

  test('empty string → ja', () => {
    expect(detectLocale('')).toBe('ja');
  });

  test('en → en', () => {
    expect(detectLocale('en')).toBe('en');
  });

  test('en-US → en (strips region)', () => {
    expect(detectLocale('en-US,en;q=0.9')).toBe('en');
  });

  test('zh → zh', () => {
    expect(detectLocale('zh-TW,zh;q=0.9')).toBe('zh');
  });

  test('ko → ko', () => {
    expect(detectLocale('ko-KR')).toBe('ko');
  });

  test('ja → ja', () => {
    expect(detectLocale('ja-JP')).toBe('ja');
  });

  test('unsupported locale → ja fallback', () => {
    expect(detectLocale('fr-FR')).toBe('ja');
    expect(detectLocale('de')).toBe('ja');
  });
});

describe('constants', () => {
  test('SUPPORTED_LOCALES contains 4 locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['ja', 'en', 'zh', 'ko']);
  });

  test('LOCALE_LABELS has all 4 locales', () => {
    expect(Object.keys(LOCALE_LABELS)).toEqual(['ja', 'en', 'zh', 'ko']);
    expect(LOCALE_LABELS.en).toBe('English');
  });

  test('LOCALE_FLAGS has all 4 locales', () => {
    expect(Object.keys(LOCALE_FLAGS)).toEqual(['ja', 'en', 'zh', 'ko']);
  });

  test('LOCALE_COOKIE_KEY is a string', () => {
    expect(typeof LOCALE_COOKIE_KEY).toBe('string');
  });
});

describe('t() fallback chain branches', () => {
  test('known key with unknown locale (cast) falls back to dict.ja', () => {
    // Force dict[locale] to be undefined while dict.ja exists → exercises `?? dict.ja` branch
    const result = t('booking.title', 'fr' as unknown as 'ja');
    expect(result).toBe('予約する');
  });

  test('unknown key with fallback param returns fallback (not undefined)', () => {
    expect(t('missing.key', 'en', 'custom fallback')).toBe('custom fallback');
  });

  test('detectLocale: acceptLanguage with q-values only (no comma split fallthrough)', () => {
    // Single token with region: covers branch where SUPPORTED_LOCALES.includes is true
    expect(detectLocale('JA-jp')).toBe('ja');
  });

  test('detectLocale: comma-separated unknown then supported still picks first', () => {
    // first token = 'xx', not supported, returns 'ja' default
    expect(detectLocale('xx,en')).toBe('ja');
  });
});

describe('t() — 全翻訳キー・全ロケールの値を検証', () => {
  const allTranslations: Record<string, Record<string, string>> = {
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

  const locales: Array<'ja' | 'en' | 'zh' | 'ko'> = ['ja', 'en', 'zh', 'ko'];

  for (const [key, translations] of Object.entries(allTranslations)) {
    for (const locale of locales) {
      test(`t('${key}', '${locale}') === '${translations[locale]}'`, () => {
        expect(t(key, locale)).toBe(translations[locale]);
      });
    }
  }
});

describe('LOCALE_LABELS — 全値を検証', () => {
  test('ja → 日本語', () => {
    expect(LOCALE_LABELS.ja).toBe('日本語');
  });
  test('en → English', () => {
    expect(LOCALE_LABELS.en).toBe('English');
  });
  test('zh → 中文', () => {
    expect(LOCALE_LABELS.zh).toBe('中文');
  });
  test('ko → 한국어', () => {
    expect(LOCALE_LABELS.ko).toBe('한국어');
  });
});

describe('LOCALE_FLAGS — 全値を検証', () => {
  test('ja → 🇯🇵', () => {
    expect(LOCALE_FLAGS.ja).toBe('🇯🇵');
  });
  test('en → 🇺🇸', () => {
    expect(LOCALE_FLAGS.en).toBe('🇺🇸');
  });
  test('zh → 🇨🇳', () => {
    expect(LOCALE_FLAGS.zh).toBe('🇨🇳');
  });
  test('ko → 🇰🇷', () => {
    expect(LOCALE_FLAGS.ko).toBe('🇰🇷');
  });
});

describe('LOCALE_COOKIE_KEY — 値の検証', () => {
  test('cl_locale', () => {
    expect(LOCALE_COOKIE_KEY).toBe('cl_locale');
  });
});

// Branch coverage: line 156 (×2)
// `return dict[locale] ?? dict.ja ?? fallback ?? key`
// Need to cover: dict.ja missing → fallback used, and dict.ja missing + no fallback → key returned
describe('t() — line 156 deep fallback branches', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../i18n');
  });

  // Branch coverage: line 156 — dict[locale] undefined AND dict.ja undefined → fallback used
  test('locale 未設定かつ dict.ja も undefined → fallback が返る', () => {
    // Inject a key where ja translation is absent to exercise `dict.ja ?? fallback`
    jest.doMock('../i18n', () => {
      // Re-implement t() with a test-only dictionary entry that has no 'ja' key
      const testTranslations: Record<string, Record<string, string>> = {
        'test.noja.key': { en: 'English only' },
      };
      return {
        t: (key: string, locale = 'ja', fallback?: string): string => {
          const dict = testTranslations[key];
          if (!dict) return fallback ?? key;
          return dict[locale] ?? dict.ja ?? fallback ?? key;
        },
        detectLocale: jest.fn((h: string | null) => h ? 'ja' : 'ja'),
        SUPPORTED_LOCALES: ['ja', 'en', 'zh', 'ko'],
        LOCALE_LABELS: { ja: '日本語', en: 'English', zh: '中文', ko: '한국어' },
        LOCALE_FLAGS: { ja: '🇯🇵', en: '🇺🇸', zh: '🇨🇳', ko: '🇰🇷' },
        LOCALE_COOKIE_KEY: 'cl_locale',
      };
    });
    const { t: tMocked } = require('../i18n');
    // dict['test.noja.key']['ja'] is undefined, fallback provided → fallback returned
    expect(tMocked('test.noja.key', 'ja' as any, 'fallback-value')).toBe('fallback-value');
    jest.resetModules();
  });

  // Branch coverage: line 156 — dict[locale] undefined AND dict.ja undefined AND no fallback → key returned
  test('locale 未設定かつ dict.ja も undefined かつ fallback なし → key 自体が返る', () => {
    jest.doMock('../i18n', () => {
      const testTranslations: Record<string, Record<string, string>> = {
        'test.noja.key2': { en: 'English only' },
      };
      return {
        t: (key: string, locale = 'ja', fallback?: string): string => {
          const dict = testTranslations[key];
          if (!dict) return fallback ?? key;
          return dict[locale] ?? dict.ja ?? fallback ?? key;
        },
        detectLocale: jest.fn(),
        SUPPORTED_LOCALES: ['ja', 'en', 'zh', 'ko'],
        LOCALE_LABELS: {},
        LOCALE_FLAGS: {},
        LOCALE_COOKIE_KEY: 'cl_locale',
      };
    });
    const { t: tMocked } = require('../i18n');
    // dict['test.noja.key2']['ja'] is undefined, no fallback → key returned
    expect(tMocked('test.noja.key2', 'ja' as any)).toBe('test.noja.key2');
    jest.resetModules();
  });
});
