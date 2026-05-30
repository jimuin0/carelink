/**
 * L5 プロパティベーステスト（fast-check）
 *
 * 対象: 外部副作用のない純粋関数
 *   - formatPhone         (validations.ts)
 *   - normalizeSiteUrl    (constants.ts)
 *   - getTransformUrl     (image-utils.ts)
 *   - getPrefectureSlug / getPrefectureName   (seo-constants.ts)
 *   - getBusinessTypeSlug / getBusinessTypeName (seo-constants.ts)
 *   - safeJsonLd          (json-ld.ts)
 */

import * as fc from 'fast-check';
import { formatPhone } from '../validations';
import { normalizeSiteUrl } from '../constants';
import { getTransformUrl } from '../image-utils';
import { safeJsonLd } from '../json-ld';
import {
  getPrefectureSlug,
  getPrefectureName,
  getBusinessTypeSlug,
  getBusinessTypeName,
  isValidPrefectureSlug,
  isValidBusinessTypeSlug,
  prefectureSlugs,
  businessTypeSlugs,
  allPrefectureSlugs,
  allBusinessTypeSlugs,
} from '../seo-constants';

// ---------------------------------------------------------------------------
// formatPhone
// ---------------------------------------------------------------------------

describe('formatPhone — property tests', () => {
  test('出力は数字とハイフンのみ（任意の文字列入力）', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = formatPhone(s);
        expect(result).toMatch(/^[0-9-]*$/);
      }),
    );
  });

  test('冪等性: formatPhone(formatPhone(s)) === formatPhone(s)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = formatPhone(s);
        const twice = formatPhone(once);
        expect(twice).toBe(once);
      }),
    );
  });

  test('出力の数字部分は入力の数字部分と等しい（桁数保存）', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const inputDigits = s.replace(/\D/g, '');
        const outputDigits = formatPhone(s).replace(/-/g, '');
        // 出力は先頭11桁まで（各分岐の最大 slice 範囲）に切り捨てられる場合がある
        // 少なくとも出力の数字は入力の数字のプレフィックスである
        expect(inputDigits.startsWith(outputDigits)).toBe(true);
      }),
    );
  });

  test('数字のみ入力: ハイフンを除いた出力 = 入力（最大11桁）', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{0,11}$/), (digits) => {
        const result = formatPhone(digits);
        const resultDigits = result.replace(/-/g, '');
        expect(resultDigits).toBe(digits.slice(0, resultDigits.length));
        expect(digits.startsWith(resultDigits)).toBe(true);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeSiteUrl
// ---------------------------------------------------------------------------

describe('normalizeSiteUrl — property tests', () => {
  test('出力は末尾スラッシュを持たない（任意の文字列）', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined)), (raw) => {
        const result = normalizeSiteUrl(raw as string | undefined);
        expect(result.endsWith('/')).toBe(false);
      }),
    );
  });

  test('冪等性: normalizeSiteUrl(normalizeSiteUrl(s)) === normalizeSiteUrl(s)（任意の文字列）', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined)), (raw) => {
        const once = normalizeSiteUrl(raw as string | undefined);
        const twice = normalizeSiteUrl(once);
        expect(twice).toBe(once);
      }),
    );
  });

  test('末尾スラッシュ付き文字列: 追加 "/" は結果に影響しない', () => {
    // trim() → スラッシュ除去 → trim() の順序で処理するため、
    // 末尾に "/" を追加しても結果は変わらない
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r1 = normalizeSiteUrl(s + '/');
        const r2 = normalizeSiteUrl(s);
        expect(r1).toBe(r2);
      }),
    );
  });

  test('空白のみ文字列 → デフォルト https://carelink-jp.com', () => {
    // 空白のみは trim() 後に falsy → デフォルトにフォールバック
    fc.assert(
      fc.property(fc.stringMatching(/^\s+$/), (s) => {
        expect(normalizeSiteUrl(s)).toBe('https://carelink-jp.com');
      }),
    );
  });

  test('https:// または http:// で始まる URL → 出力は末尾スラッシュなし', () => {
    // HTTP/HTTPS URL の正規化後は末尾スラッシュが除去される
    const httpUrl = fc.webUrl({ withFragments: false });
    fc.assert(
      fc.property(httpUrl, (url) => {
        expect(normalizeSiteUrl(url).endsWith('/')).toBe(false);
      }),
    );
  });

  test('https:// URL: 出力は https://www.carelink-jp.com で始まらない', () => {
    // www.carelink-jp.com は常に apex に変換される
    const httpUrl = fc.webUrl({ withFragments: false });
    fc.assert(
      fc.property(httpUrl, (url) => {
        expect(normalizeSiteUrl(url).startsWith('https://www.carelink-jp.com')).toBe(false);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getTransformUrl
// ---------------------------------------------------------------------------

describe('getTransformUrl — property tests', () => {
  test('null → 常に空文字', () => {
    fc.assert(
      fc.property(fc.record({
        width: fc.option(fc.nat(2000), { nil: undefined }),
        height: fc.option(fc.nat(2000), { nil: undefined }),
        quality: fc.option(fc.nat(100), { nil: undefined }),
      }), (opts) => {
        expect(getTransformUrl(null, opts)).toBe('');
      }),
    );
  });

  test('undefined → 常に空文字', () => {
    fc.assert(
      fc.property(fc.record({
        width: fc.option(fc.nat(2000), { nil: undefined }),
      }), (opts) => {
        expect(getTransformUrl(undefined, opts)).toBe('');
      }),
    );
  });

  test('Supabase以外のURL: オプション付きでも入力をそのまま返す', () => {
    // Supabase URL のパターン /storage/v1/object/public/ を含まない URL
    const nonSupabaseUrl = fc.string({ minLength: 1 }).filter(
      (s) => !s.includes('/storage/v1/object/public/') && s.length > 0,
    );
    fc.assert(
      fc.property(
        nonSupabaseUrl,
        fc.record({
          width: fc.option(fc.nat(2000), { nil: undefined }),
          height: fc.option(fc.nat(2000), { nil: undefined }),
          quality: fc.option(fc.nat(100), { nil: undefined }),
        }),
        (url, opts) => {
          expect(getTransformUrl(url, opts)).toBe(url);
        },
      ),
    );
  });

  test('Supabase URL: 出力は /storage/v1/render/image/public/ を含む', () => {
    const supabaseUrl = fc.string().map(
      (path) => `https://abc.supabase.co/storage/v1/object/public/${path}`,
    );
    fc.assert(
      fc.property(supabaseUrl, (url) => {
        const result = getTransformUrl(url);
        expect(result).toContain('/storage/v1/render/image/public/');
        expect(result).not.toContain('/storage/v1/object/public/');
      }),
    );
  });

  test('width オプション: 1以上の指定値が出力に含まれる', () => {
    // width=0 は falsy のため URLSearchParams に追加されない仕様（有効値は1以上）
    const supabaseUrl = `https://abc.supabase.co/storage/v1/object/public/salons/photo.jpg`;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), (w) => {
        const result = getTransformUrl(supabaseUrl, { width: w });
        expect(result).toContain(`width=${w}`);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getPrefectureSlug / getPrefectureName (seo-constants.ts)
// ---------------------------------------------------------------------------

const prefectureNames = Object.values(prefectureSlugs); // 47都道府県名
const prefectureSlugsArray = allPrefectureSlugs;        // 47スラッグ

describe('getPrefectureSlug / getPrefectureName — property tests', () => {
  test('既知の都道府県名: ラウンドトリップ name → slug → name', () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefectureNames), (name) => {
        const slug = getPrefectureSlug(name);
        expect(slug).toBeDefined();
        expect(getPrefectureName(slug!)).toBe(name);
      }),
    );
  });

  test('既知のスラッグ: ラウンドトリップ slug → name → slug', () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefectureSlugsArray), (slug) => {
        const name = getPrefectureName(slug);
        expect(name).toBeDefined();
        expect(getPrefectureSlug(name!)).toBe(slug);
      }),
    );
  });

  test('未知の文字列: getPrefectureSlug は undefined を返す', () => {
    // 既知の都道府県名と重複しない文字列を生成
    const unknownStr = fc.string().filter((s) => !prefectureNames.includes(s));
    fc.assert(
      fc.property(unknownStr, (s) => {
        expect(getPrefectureSlug(s)).toBeUndefined();
      }),
    );
  });

  test('未知のスラッグ: getPrefectureName は undefined を返す', () => {
    const unknownSlug = fc.string().filter((s) => !prefectureSlugsArray.includes(s));
    fc.assert(
      fc.property(unknownSlug, (s) => {
        expect(getPrefectureName(s)).toBeUndefined();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getBusinessTypeSlug / getBusinessTypeName (seo-constants.ts)
// ---------------------------------------------------------------------------

const businessTypeNames = Object.values(businessTypeSlugs);
const businessTypeSlugsArray = allBusinessTypeSlugs;

describe('getBusinessTypeSlug / getBusinessTypeName — property tests', () => {
  test('既知の業種名: ラウンドトリップ name → slug → name', () => {
    fc.assert(
      fc.property(fc.constantFrom(...businessTypeNames), (name) => {
        const slug = getBusinessTypeSlug(name);
        expect(slug).toBeDefined();
        expect(getBusinessTypeName(slug!)).toBe(name);
      }),
    );
  });

  test('既知のスラッグ: ラウンドトリップ slug → name → slug', () => {
    fc.assert(
      fc.property(fc.constantFrom(...businessTypeSlugsArray), (slug) => {
        const name = getBusinessTypeName(slug);
        expect(name).toBeDefined();
        expect(getBusinessTypeSlug(name!)).toBe(slug);
      }),
    );
  });

  test('未知の文字列: getBusinessTypeSlug は undefined を返す', () => {
    const unknownStr = fc.string().filter((s) => !businessTypeNames.includes(s));
    fc.assert(
      fc.property(unknownStr, (s) => {
        expect(getBusinessTypeSlug(s)).toBeUndefined();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// isValidPrefectureSlug / isValidBusinessTypeSlug (seo-constants.ts)
// ---------------------------------------------------------------------------

describe('isValidPrefectureSlug / isValidBusinessTypeSlug — property tests', () => {
  test('既知のスラッグ: isValidPrefectureSlug は true を返す', () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefectureSlugsArray), (slug) => {
        expect(isValidPrefectureSlug(slug)).toBe(true);
      }),
    );
  });

  test('未知の文字列: isValidPrefectureSlug は false を返す', () => {
    // __proto__ / constructor / toString 等のプロトタイプキーも false を返す
    const unknownSlug = fc.string().filter((s) => !prefectureSlugsArray.includes(s));
    fc.assert(
      fc.property(unknownSlug, (s) => {
        expect(isValidPrefectureSlug(s)).toBe(false);
      }),
    );
  });

  test('既知のスラッグ: isValidBusinessTypeSlug は true を返す', () => {
    fc.assert(
      fc.property(fc.constantFrom(...businessTypeSlugsArray), (slug) => {
        expect(isValidBusinessTypeSlug(slug)).toBe(true);
      }),
    );
  });

  test('未知の文字列: isValidBusinessTypeSlug は false を返す', () => {
    const unknownSlug = fc.string().filter((s) => !businessTypeSlugsArray.includes(s));
    fc.assert(
      fc.property(unknownSlug, (s) => {
        expect(isValidBusinessTypeSlug(s)).toBe(false);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// safeJsonLd (json-ld.ts) — XSS防止シリアライザ
// ---------------------------------------------------------------------------

// JSON 化可能な任意の値（文字列・数値・真偽・null・配列・オブジェクトの再帰構造）
// maxDepth で再帰の深さを制限する。理由:
//   無制限だと巨大なネスト構造が生成され、Stryker の perTest ミューテーション
//   （json-ld.ts の各変異体ごとに本テストを再実行）で1変異体あたりが極端に重くなり
//   timeout を量産してランがハングする。深さ3でも < > & を含む文字列・全プリミティブ・
//   ネストした配列/オブジェクトを十分カバーでき、不変条件の検証強度は保たれる。
const jsonValue = fc.jsonValue({ maxDepth: 3 });

describe('safeJsonLd — property tests', () => {
  test('出力に生の < > & を一切含まない（任意のJSON値）', () => {
    // <script> ブレイクアウトXSSを防ぐため、3文字は必ずエスケープされる
    fc.assert(
      fc.property(jsonValue, (v) => {
        const result = safeJsonLd(v);
        expect(result).not.toMatch(/[<>&]/);
      }),
    );
  });

  test('ラウンドトリップ: safeJsonLd のパース結果はバニラ JSON.stringify と等価', () => {
    // safeJsonLd の不変条件は「エスケープがデータを変えない」こと。
    // 元の値 v と直接比較すると JSON 自体の正規化（例: -0 → 0）に巻き込まれて
    // フレーキーになるため、バニラ JSON.stringify のパース結果と比較して
    // 「エスケープ以外の差異がない」ことだけを検証する。
    fc.assert(
      fc.property(jsonValue, (v) => {
        const viaSafe = JSON.parse(safeJsonLd(v));
        const viaVanilla = JSON.parse(JSON.stringify(v));
        expect(viaSafe).toEqual(viaVanilla);
      }),
    );
  });

  test('出力は常に有効なJSON（JSON.parseが投げない）', () => {
    fc.assert(
      fc.property(jsonValue, (v) => {
        expect(() => JSON.parse(safeJsonLd(v))).not.toThrow();
      }),
    );
  });

  test('< を含む文字列: 出力に \\u003c が含まれ生の < は消える', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = safeJsonLd(`${s}<${s}`);
        expect(result).toContain('\\u003c');
        expect(result).not.toContain('<');
      }),
    );
  });

  test('> を含む文字列: 出力に \\u003e が含まれ生の > は消える', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = safeJsonLd(`${s}>${s}`);
        expect(result).toContain('\\u003e');
        expect(result).not.toContain('>');
      }),
    );
  });

  test('& を含む文字列: 出力に \\u0026 が含まれ生の & は消える', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = safeJsonLd(`${s}&${s}`);
        expect(result).toContain('\\u0026');
        expect(result).not.toContain('&');
      }),
    );
  });

  test('冪等性なし検証: </script> ブレイクアウト文字列は必ず無害化される', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const payload = `${s}</script><img src=x onerror=alert(1)>`;
        const result = safeJsonLd({ x: payload });
        expect(result).not.toContain('</script>');
        expect(result).not.toMatch(/[<>&]/);
      }),
    );
  });
});
