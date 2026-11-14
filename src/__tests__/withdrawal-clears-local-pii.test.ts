/**
 * 退会経路が「端末に残る個人情報の消去」を必ず通ることを CI で強制する。
 *
 * 🔴 なぜ配線まで見るか
 * clearStoredPersonalData 自体の単体テストが緑でも、呼び出しが外れていれば実害は残る
 * （＝関数が「在るだけで配線されていない」状態を緑にしない）。退会は取り返しがつかない操作で、
 * 落ちたことに誰も気づけないため、呼び出しの実在を機械で見る。
 *
 * 併せて、下書きキーの組み立てが単一ソース（src/lib/client-storage.ts）に閉じていることも見る。
 * 別の場所で 'booking-draft:' を直書きされると、消去側が知らないキーが生まれて消し漏れる。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');

/**
 * 退会成功後に全リロードする画面の台帳。下の「台帳と実ファイルの一致」検査が、
 * src 全体から退会 API（/api/account/delete）を呼ぶ画面を走査して突き合わせるので、
 * 新しい退会画面を足したのに台帳へ載せ忘れると CI が落ちる（＝配線漏れを新画面にも効かせる）。
 */
const WITHDRAWAL_FILES = [
  'src/app/mypage/profile/page.tsx',
  'src/components/admin/WithdrawalSettings.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('退会時の端末側 PII 消去', () => {
  it('検査対象の退会画面が実在する（パス変更で空振りしないこと）', () => {
    for (const file of WITHDRAWAL_FILES) {
      expect(() => readFileSync(join(process.cwd(), file), 'utf8')).not.toThrow();
    }
  });

  it('退会 API を呼ぶ画面はすべて台帳に載っている（新しい退会画面の配線漏れを検出する）', () => {
    const callers = walk(SRC)
      .filter((file) => !file.includes('__tests__') && !/\.test\.tsx?$/.test(file))
      .filter((file) => !file.includes(join('app', 'api') + '/'))
      .filter((file) => /['"`]\/api\/account\/delete['"`?]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(process.cwd().length + 1).split('\\').join('/'))
      .sort();
    expect(callers).toEqual([...WITHDRAWAL_FILES].sort());
  });

  it.each(WITHDRAWAL_FILES)('%s は不可逆な削除HTTPより前に非同期の端末消去を検証する', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    // 空振り防止: そもそも全リロードしている画面であることを先に確かめる。
    // 絶対 URL への assign はクライアント遷移ではなく全ページ再読み込みになる（メモリ上の認証情報も破棄される）。
    // 削除リクエストの後にある再読み込みを対象にする（「トップへ進む」リンクにも同じ式がある）。
    const deleteIndex = source.indexOf("fetch('/api/account/delete'");
    const reloadIndex = source.indexOf('window.location.assign(window.location.origin);', deleteIndex);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(reloadIndex).toBeGreaterThan(-1);

    const clearIndex = source.indexOf('await clearAccountLocalData()');
    expect(clearIndex).toBeGreaterThan(-1);
    // 遷移してからでは同じタブで実行される保証がない。必ず前に置く。
    expect(clearIndex).toBeLessThan(reloadIndex);
    expect(clearIndex).toBeLessThan(source.indexOf("fetch('/api/account/delete'"));
  });

  it("下書きキーの組み立ては client-storage.ts だけが持つ", () => {
    const offenders = walk(SRC)
      .filter((file) => !file.endsWith(join('lib', 'client-storage.ts')))
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => readFileSync(file, 'utf8').includes('booking-draft:'));

    expect(offenders).toEqual([]);
  });
});
