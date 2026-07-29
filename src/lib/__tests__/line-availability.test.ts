/**
 * LINE 機能の出し分けが「LIFF の設定有無」に従属していることを固定する（2026年7月29日 新設）。
 *
 * 【背景】
 * LINE の送信コードは配線済み・アクセストークンも設定済みだったが、顧客が連携する入口
 * （LIFF）が無いため本番では一度も送信されていなかった（line_user_links 0件・
 * line_notification_logs 0件）。それでも UI は顧客に「LINE連携すると予約確認が届きます」、
 * 施設に「LINEで送る（有料）」を見せ続けていた。ローンチ段階では LINE を設定しない方針。
 *
 * 【このテストが守るもの】
 * 表示を手動フラグで隠すと、後で LIFF を設定したときの戻し忘れ（設定したのに出ない）と、
 * フラグだけ戻す事故（出るのに動かない）の両方が起きる。表示は必ず設定に従属させる。
 * ここでは isLineEnabled が LIFF ID の有無と 1 対 1 で対応することを両方向で固定し、
 * UI 側がこの関数を経由していることを併せて検証する。
 */

describe('isLineEnabled', () => {
  const original = process.env.NEXT_PUBLIC_LIFF_ID;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
    else process.env.NEXT_PUBLIC_LIFF_ID = original;
    jest.resetModules();
  });

  function load() {
    let fn!: () => boolean;
    jest.isolateModules(() => {
      fn = require('@/lib/line-availability').isLineEnabled;
    });
    return fn;
  }

  test('LIFF ID 未設定なら false（ローンチ時点の状態）', () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    expect(load()()).toBe(false);
  });

  test('LIFF ID が空文字なら false（変数だけ作って値を入れ忘れた場合）', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = '';
    expect(load()()).toBe(false);
  });

  test('LIFF ID が入っていれば true（神原さんが値を入れた瞬間に復活する）', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = '1234567890-abcdefgh';
    expect(load()()).toBe(true);
  });
});

describe('LINE の表示箇所は必ず isLineEnabled を経由する', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  // 顧客・施設が LINE を目にする4箇所。ここに手動フラグや直書きの表示が戻ると、
  // 「動かないのに見せる」状態が再発する。
  const SITES = [
    ['src/app/mypage/settings/page.tsx', '客: マイページ設定のLINE連携'],
    ['src/app/mypage/profile/page.tsx', '客: プロフィールのLINE連携'],
    ['src/components/admin/ReminderUpsellSettings.tsx', '店舗: リマインドLINE（有料）'],
    ['src/components/admin/AdjustRequestButtons.tsx', '店舗: LINEで送る（有料）'],
  ] as const;

  test.each(SITES)('%s（%s）が isLineEnabled を使っている', (path) => {
    const src = read(path);
    expect(src).toContain("from '@/lib/line-availability'");
    expect(src).toContain('isLineEnabled()');
  });

  // 連携済みの人から解除手段を奪わないこと。LIFF を後から外した場合でも、
  // 既に連携している顧客は自分で解除できなければならない。
  test.each([
    ['src/app/mypage/settings/page.tsx'],
    ['src/app/mypage/profile/page.tsx'],
  ])('%s は連携済みなら LIFF 未設定でも表示する', (path) => {
    expect(read(path)).toContain('(isLineEnabled() || lineLinked)');
  });

  // 表示を隠すだけで、保存済みの設定やサーバ側の権利チェックは触らない。
  // ここを消すと、後で LINE を有効化したときに施設の設定が失われる。
  test('リマインド設定は定義を残したまま表示行だけ絞る', () => {
    const src = read('src/components/admin/ReminderUpsellSettings.tsx');
    expect(src).toMatch(/ROWS\s*=\s*ALL_ROWS\.filter/);

    // 【重要】`expect(src).toContain('remind_7d_line')` では検証にならない。
    // 同じ文字列が interface ReminderSettings と DEFAULT_SETTINGS にも現れるため、
    // ALL_ROWS から LINE 行を削除してもテストが緑のままだった（敵対検証で実際に素通り・
    // 2026年7月29日）。行定義そのものが残っているかを ALL_ROWS の中だけで確かめる。
    const start = src.indexOf('const ALL_ROWS');
    const end = src.indexOf('];', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const allRows = src.slice(start, end);
    for (const key of ['remind_7d_line', 'remind_3d_line']) {
      expect(allRows).toContain(key);
    }
  });

  // 手動フラグへの逆戻りを禁じる（戻し忘れ事故の再発防止）。
  test.each(SITES)('%s に手動の隠しフラグが無い', (path) => {
    expect(read(path)).not.toMatch(/LAUNCH_HIDDEN|HIDE_LINE|LINE_DISABLED/);
  });
});
