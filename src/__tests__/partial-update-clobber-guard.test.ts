/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 部分更新(PATCH)が「送られていない列」を null で塗り潰す書き方を禁止する（2026年8月11日 新設）。
 *
 * 【何が起きていたか＝実害】zod の `.optional()` は未指定キーを出力オブジェクトに含めない。
 * そのため
 *
 *     .update({ ...parsed.data, photo_url: parsed.data.photo_url || null })
 *
 * と書くと、`photo_url` を含まない PATCH でも spread の【後ろ】に置いた明示キーが必ず勝ち、
 * 常に null が書き込まれる。本番で実際にこうなっていた:
 *   ・/admin/menus の並び替え(↑↓) … `{ sort_order }` だけ送る → メニュー写真が消える
 *   ・/admin/features の公開トグル … `{ is_active }` だけ送る → 特集記事の画像が消える
 * どちらも「保存した覚えが無いのに画像だけ消える」形なので、気づくのが極めて遅れる。
 *
 * 【なぜ静的検査なのか】ルート単体テストは「そのルートを直したこと」しか保証しない。
 * この書き方は短くて自然に見えるので、次に画像列を足す人がまた同じ形で書く。形そのものを禁じる。
 *
 * 正しい書き方（blog/[id]・inquiries/[id] などが既に採っている形）:
 *
 *     const updatePayload: Record<string, unknown> = { ...parsed.data };
 *     if (parsed.data.photo_url !== undefined) updatePayload.photo_url = parsed.data.photo_url || null;
 *
 * 【この検査の射程】上記の「spread の後ろで parsed.data.X を || / ?? で潰す」形だけを見る。
 * 部分更新の取りこぼし全般を検出するものではない（そこは各ルートのテストの担当）。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkRoutes(full));
    else if (full.endsWith(`${sep}route.ts`)) out.push(full);
  }
  return out;
}

/**
 * `.update({ ...X, … X.key || … })` を検出する（X は `parsed.data` でも別名でもよい）。
 *
 * 後方参照で「spread した変数と同じ変数から取り出した値」に限定している。`const d = parsed.data`
 * のような別名は本リポジトリに実在する書き方（salons / bookings / profile / inquiry）なので、
 * `parsed\.data` 決め打ちだと別名で書かれた瞬間に素通りする。
 * `[^}]*` で同一のオブジェクトリテラル内に限定するので、離れた場所の `||` は拾わない。
 */
const CLOBBER_RE = /\.update\(\s*\{\s*\.\.\.(\w+(?:\.\w+)?)\s*,[^}]*\1\.\w+\s*(?:\|\||\?\?)/;

describe('部分更新が未送信の列を潰さない', () => {
  it('検出正規表現が機能する（負の対照つき）', () => {
    // 実際に本番へ入っていた欠陥そのままの形
    expect(
      CLOBBER_RE.test('.update({ ...parsed.data, photo_url: parsed.data.photo_url || null })')
    ).toBe(true);
    expect(
      CLOBBER_RE.test('.update({ ...parsed.data, image_url: parsed.data.image_url ?? null })')
    ).toBe(true);
    // 別名で書かれても検出する（`const d = parsed.data` はこのリポジトリに実在する書き方）
    expect(CLOBBER_RE.test('.update({ ...d, photo_url: d.photo_url || null })')).toBe(true);
    // 別変数から取った値の既定値埋めは対象外（spread 元と別なので「未送信の列を潰す」形ではない）
    expect(CLOBBER_RE.test('.update({ ...parsed.data, owner_id: ctx.userId ?? null })')).toBe(false);
    // 正しい形（別オブジェクトを組み立ててから渡す）は検出しない
    expect(CLOBBER_RE.test('.update(updatePayload)')).toBe(false);
    // spread のみ・上書き無しは検出しない
    expect(
      CLOBBER_RE.test(".update({ ...parsed.data, updated_at: new Date().toISOString() })")
    ).toBe(false);
    // insert は対象外（新規作成では「送られていない列」を既定値に倒すのが正しい）
    expect(
      CLOBBER_RE.test('.insert({ ...parsed.data, photo_url: parsed.data.photo_url || null })')
    ).toBe(false);
  });

  it('API ルートに該当する書き方が残っていない', () => {
    const routes = walkRoutes(join(ROOT, 'src/app/api'));
    // 負の対照: 走査対象ゼロを緑にしない
    expect(routes.length).toBeGreaterThan(50);

    const offenders = routes
      .filter((f) => CLOBBER_RE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split(sep).join('/'));

    expect(offenders).toEqual([]);
  });
});
