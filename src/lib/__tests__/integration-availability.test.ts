/**
 * 任意設定の外部連携の「使えるか」判定が、環境変数の有無と 1 対 1 で対応することを固定する。
 *
 * 【背景・2026年7月30日 本番実測】
 * 鍵が入っていないのに UI が機能を見せ、客と施設が踏んで失敗していた。
 *   - ANTHROPIC_API_KEY 未設定 → 全ページの AI チャットボットが 503／症状チェッカーが 500
 *   - STRIPE_SECRET_KEY 未設定 → 有料オプションが値札付きで並ぶが購入で 503
 *   - GOOGLE_CLIENT_ID/SECRET 未設定 → 連携ボタンは出るが連携できない
 * 表示を手動フラグで隠すと戻し忘れ（設定したのに出ない）と逆の事故（出るのに動かない）が
 * 起きるため、表示を設定に従属させた。本テストはその従属関係を両方向で固定する。
 */

describe('integration-availability', () => {
  const KEYS = ['ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) original[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    jest.resetModules();
  });

  function load() {
    let mod!: typeof import('@/lib/integration-availability');
    jest.isolateModules(() => {
      mod = require('@/lib/integration-availability');
    });
    return mod;
  }

  describe('isAiEnabled', () => {
    test('ANTHROPIC_API_KEY 未設定 → false（ローンチ時点の本番と同じ状態）', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(load().isAiEnabled()).toBe(false);
    });

    test('空文字 → false（変数だけ作って値を入れ忘れた場合）', () => {
      process.env.ANTHROPIC_API_KEY = '';
      expect(load().isAiEnabled()).toBe(false);
    });

    test('値あり → true（鍵を入れた瞬間に機能が復活する）', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-dummy';
      expect(load().isAiEnabled()).toBe(true);
    });
  });

  describe('isPaymentsEnabled', () => {
    // 判定は /api/options/checkout が見る変数と同じにする。ここがズレると
    // 「表示はできるのに購入は 503」が復活する。
    test('STRIPE_SECRET_KEY 未設定 → false', () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect(load().isPaymentsEnabled()).toBe(false);
    });

    test('空文字 → false', () => {
      process.env.STRIPE_SECRET_KEY = '';
      expect(load().isPaymentsEnabled()).toBe(false);
    });

    test('値あり → true', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
      expect(load().isPaymentsEnabled()).toBe(true);
    });
  });

  describe('isGoogleCalendarEnabled', () => {
    // OAuth は ID と SECRET が揃って初めて成立する。片方だけで true にすると
    // 連携ボタンを出しておいて失敗する状態に戻る。
    test('両方未設定 → false', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(load().isGoogleCalendarEnabled()).toBe(false);
    });

    test('ID のみ → false', () => {
      process.env.GOOGLE_CLIENT_ID = 'id';
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(load().isGoogleCalendarEnabled()).toBe(false);
    });

    test('SECRET のみ → false', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_CLIENT_SECRET = 'secret';
      expect(load().isGoogleCalendarEnabled()).toBe(false);
    });

    test('両方あり → true', () => {
      process.env.GOOGLE_CLIENT_ID = 'id';
      process.env.GOOGLE_CLIENT_SECRET = 'secret';
      expect(load().isGoogleCalendarEnabled()).toBe(true);
    });
  });

  // 手動フラグへの逆戻りを禁じる（戻し忘れ事故の再発防止）。
  test('判定は環境変数のみを根拠にする（ハードコードした真偽値を置かない）', () => {
    const raw = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src/lib/integration-availability.ts'),
      'utf8',
    ) as string;
    // 【重要】コメントを含めたまま検査してはならない。このファイルの解説コメントは
    // 「LAUNCH_HIDDEN のような定数で隠すな」と書いており、素の全文検索だと自分の
    // 説明文に反応して常に赤になる（初版で実際に発生・2026年7月30日）。
    // 逆に、コメントを消さずに通そうとすると検査自体を緩めることになるため、
    // コメントだけを取り除いた実コードに対して検査する。
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/LAUNCH_HIDDEN|HIDE_[A-Z_]+/);
    expect(code).not.toMatch(/return\s+(true|false)\s*;/);
    // 3つの判定がすべて process.env を読んでいること
    expect((code.match(/process\.env\./g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
