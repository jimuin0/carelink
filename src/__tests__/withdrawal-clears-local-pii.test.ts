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

/** 退会成功後に全リロードする画面。ここは増える可能性があるので実ファイルから探す。 */
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

  it.each(WITHDRAWAL_FILES)('%s は全リロードの前に消去を呼ぶ', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');

    // 空振り防止: そもそも全リロードしている画面であることを先に確かめる。
    const reloadIndex = source.indexOf("window.location.href = '/'");
    expect(reloadIndex).toBeGreaterThan(-1);

    const clearIndex = source.indexOf('clearStoredPersonalData()');
    expect(clearIndex).toBeGreaterThan(-1);
    // 遷移してからでは同じタブで実行される保証がない。必ず前に置く。
    expect(clearIndex).toBeLessThan(reloadIndex);
  });

  it("下書きキーの組み立ては client-storage.ts だけが持つ", () => {
    const offenders = walk(SRC)
      .filter((file) => !file.endsWith(join('lib', 'client-storage.ts')))
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => readFileSync(file, 'utf8').includes('booking-draft:'));

    expect(offenders).toEqual([]);
  });
});
