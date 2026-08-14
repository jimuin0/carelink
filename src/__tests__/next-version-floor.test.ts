/**
 * Next.js のバージョン下限を機械で固定する。
 *
 * 🔴 why(2026-08-13 実測): Next.js **15.5 系には、子ルートから親のリスト画面へ戻る
 *   クライアント遷移が、その画面の RSC ペイロードが約 29KB を超えると【無音で成立しなくなる】
 *   不具合がある**。URL も画面も変わらず、JS エラーも出ず、ユーザーには「押しても何も起きない」
 *   としか見えない。
 *
 *   実測（同一コード・同一データ・ペイロードのみ揃えた A/B/A 対照）:
 *     - 15.5.21 : /admin/blog/new -> /admin/blog (58,543B) 遷移せず / /admin/jobs (40,493B) 遷移せず
 *     - 15.5.23 : 同上（15 系の最新パッチでも直らない）
 *     - 16.3.0  : いずれも 200〜250ms で遷移成功
 *   閾値は求人を 1 件ずつ増やして二分探索し、28,687B 成功 / 30,641B 失敗を確認した。
 *   `jobs` 固有ではなく、ブログ記事を増やして `/admin/blog` を 58KB にすると同様に再発した。
 *
 * 【実害】`new` と `[id]/edit` を持つ管理画面（求人・ブログ・カタログ・クーポン・スタッフ・
 *   プラットフォームブログ）すべてが同じ構造を持つ。掲載件数が増えた施設のオーナーは、
 *   新規作成／編集画面から一覧へ戻れなくなる。さらに求人作成では、遷移しないので
 *   ユーザーが再送信し、**POST は毎回成功するため重複した求人が作られる**
 *   （ローカル再現で 32 件積み上がるのを実測）。
 *
 * 【なぜ「テストを直す」ではなくバージョン下限なのか】
 *   原因はアプリのコードではなくフレームワーク側にある。ペイロードを小さく保つ回避策は
 *   「閾値の下に留まっている間だけ助かる」症状ブロックで、データが増えれば必ず再発する。
 *   バージョンを下げられなくすることが、この class に対する唯一の予防になる。
 *
 * ⚠️ この下限を下げる変更をするなら、上記の再現手順で「下げても直っている」ことを
 *   実測してからにすること。数字だけ書き換えても不具合は戻る。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** この不具合が解消していることを実測で確認した最小バージョン。 */
const MIN_NEXT_MAJOR = 16;
const MIN_NEXT_MINOR = 3;

function parseSemverFloor(range: string): { major: number; minor: number; patch: number } {
  // "^16.3.0" / "16.3.0" / "~16.3.0" のいずれも下限を取り出す
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  if (!m) throw new Error(`next のバージョン指定を解釈できません: ${JSON.stringify(range)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

describe('Next.js バージョン下限（子→親遷移の無音失敗の再発防止）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  it('package.json の next が 16.3.0 以上を要求している', () => {
    const range = pkg.dependencies?.next;
    expect(typeof range).toBe('string');
    const v = parseSemverFloor(range as string);
    // major が下限未満なら即アウト。同 major なら minor で比較する。
    const ok = v.major > MIN_NEXT_MAJOR || (v.major === MIN_NEXT_MAJOR && v.minor >= MIN_NEXT_MINOR);
    expect({ requested: range, ok }).toEqual({ requested: range, ok: true });
  });

  it('実際にインストールされている next も 16.3.0 以上', () => {
    // package.json だけ上げて lock を更新し忘れる形を防ぐ（宣言と実体の乖離）。
    const installed = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', 'next', 'package.json'), 'utf8'),
    ) as { version: string };
    const v = parseSemverFloor(installed.version);
    const ok = v.major > MIN_NEXT_MAJOR || (v.major === MIN_NEXT_MAJOR && v.minor >= MIN_NEXT_MINOR);
    expect({ installed: installed.version, ok }).toEqual({ installed: installed.version, ok: true });
  });

  it('🔴 lint スクリプトが `next lint` に戻っていない（Next 16 で削除済み）', () => {
    // `next lint` は Next 16 で削除され、`next <dir>` と解釈されて
    // "Invalid project directory provided, no such directory: .../lint" で失敗する。
    // 戻すと CI の Lint ジョブが落ちるため、ここで固定する。
    expect(pkg.scripts?.lint).toBeDefined();
    expect(pkg.scripts?.lint).not.toBe('next lint');
    expect(pkg.scripts?.lint).toContain('eslint');
  });

  it('負の対照: 判定関数が古いバージョンを実際に弾く', () => {
    // 「常に true を返すだけ」の検査になっていないことを固定する。
    const older = ['15.5.21', '^15.5.23', '~15.0.0', '16.2.12'];
    for (const range of older) {
      const v = parseSemverFloor(range);
      const ok = v.major > MIN_NEXT_MAJOR || (v.major === MIN_NEXT_MAJOR && v.minor >= MIN_NEXT_MINOR);
      expect({ range, ok }).toEqual({ range, ok: false });
    }
    // 逆方向: 下限ちょうど・それ以上は通る
    for (const range of ['16.3.0', '^16.3.1', '17.0.0']) {
      const v = parseSemverFloor(range);
      const ok = v.major > MIN_NEXT_MAJOR || (v.major === MIN_NEXT_MAJOR && v.minor >= MIN_NEXT_MINOR);
      expect({ range, ok }).toEqual({ range, ok: true });
    }
  });
});
