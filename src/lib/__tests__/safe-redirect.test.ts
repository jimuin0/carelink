/**
 * safeRedirect の検査。
 *
 * 🔴 中心にあるのは「文字列の形では守れない」という事実。
 * 旧ガード `raw.startsWith('/') && !raw.startsWith('//')` を並べて実行し、
 * それが通してしまう値を safeRedirect が止めることを**同じテスト内で対比**する。
 * 対比を書いておかないと、将来また「先頭2文字を見るだけ」に戻されたときに
 * このテストが緑のまま通ってしまう。
 */
import { safeRedirect, DEFAULT_REDIRECT } from '../safe-redirect';

const ORIGIN = 'https://carelink-jp.com';

/** 各所にコピーされていた旧ガード。比較のためだけに再現する。 */
function legacyGuard(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : DEFAULT_REDIRECT;
}

describe('safeRedirect', () => {
  describe('通すべきもの', () => {
    it.each([
      ['/mypage', '/mypage'],
      ['/admin', '/admin'],
      ['/admin/onboarding', '/admin/onboarding'],
      // redirect 自身が持つクエリは保持する（施設名・業種の引き継ぎに必要）
      ['/admin/onboarding?facility_name=%E3%83%86%E3%82%B9%E3%83%88', '/admin/onboarding?facility_name=%E3%83%86%E3%82%B9%E3%83%88'],
      ['/facility/abc#reviews', '/facility/abc#reviews'],
    ])('%s → %s', (raw, expected) => {
      expect(safeRedirect(raw, ORIGIN)).toBe(expected);
    });
  });

  describe('止めるべきもの', () => {
    it.each([
      ['https://evil.example.com', '絶対URL'],
      ['//evil.example.com', 'プロトコル相対'],
      ['javascript:alert(1)', '別スキーム'],
      ['mypage', '先頭がスラッシュでない'],
      ['', '空文字'],
    ])('%s（%s）は既定へ倒す', (raw) => {
      expect(safeRedirect(raw, ORIGIN)).toBe(DEFAULT_REDIRECT);
    });

    it('null / undefined は既定へ倒す', () => {
      expect(safeRedirect(null, ORIGIN)).toBe(DEFAULT_REDIRECT);
      expect(safeRedirect(undefined, ORIGIN)).toBe(DEFAULT_REDIRECT);
    });
  });

  describe('🔴 旧ガードが素通りさせていた値（この検査が本体）', () => {
    // URL パーサはバックスラッシュを / に正規化するため、先頭2文字だけを見る
    // 判定では外部オリジンへの脱出を止められない。
    it.each([
      ['/\\evil.example.com'],
      ['/\\\\evil.example.com'],
      ['/\\/evil.example.com'],
    ])('%s : 旧ガードは通すが safeRedirect は止める', (raw) => {
      // 負の対照 — 旧ガードは危険な値をそのまま返していた
      expect(legacyGuard(raw)).toBe(raw);
      // 実際に外部オリジンへ解決されることを示す（主張の根拠をテスト内に残す）
      expect(new URL(raw, ORIGIN).origin).not.toBe(ORIGIN);
      // 本体 — safeRedirect は既定へ倒す
      expect(safeRedirect(raw, ORIGIN)).toBe(DEFAULT_REDIRECT);
    });
  });

  it('オリジンが異なる環境（プレビュー等）でも同一オリジン判定で動く', () => {
    const preview = 'https://carelink-git-foo.vercel.app';
    expect(safeRedirect('/admin', preview)).toBe('/admin');
    expect(safeRedirect('https://carelink-jp.com/admin', preview)).toBe(DEFAULT_REDIRECT);
  });
});
