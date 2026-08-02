/**
 * `scripts/schema-diff.mjs` の除外(allow)規約を機械で固定する。
 *
 * 🔴 なぜ要るか（2026年8月2日・自分の欠陥を敵対検証で発見）:
 *   最初の実装は `line.startsWith('#') && !line.includes('##')` でコメントを判定しており、
 *   **書式を説明したコメント行**（`# 書式: <パターン> ## <理由>`）が実ルールとして
 *   登録されていた。ルール 0 本のはずの導入時ファイルで 1 本が有効になっており、
 *   説明文が本物のドリフトを黙って抑止し得た。
 *   CLAUDE.md にも同型（コメント中の文字列を実体と誤認）が 2 件記録されている。
 *
 * 規約:
 *   - `#` で始まる行は無条件にコメント
 *   - `<パターン> ## <理由>` の理由が空なら **無効**（印を付ければ通る、にしない）
 *   - 区切りが無い行も無効（黙って無視しない＝設定ミスが無音にならない）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const ALLOW_FILE = join(ROOT, 'scripts', 'schema-drift-allow.txt');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseAllow: (t: string) => { rules: any[]; invalid: any[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let matchAllow: (l: string, r: any[]) => any;

beforeAll(async () => {
  const mod = await import(join(ROOT, 'scripts', 'schema-diff.mjs'));
  parseAllow = mod.parseAllow;
  matchAllow = mod.matchAllow;
});

describe('除外(allow)ファイルの規約', () => {
  it('🔴 コメント行は "##" を含んでいてもルールにならない', () => {
    const r = parseAllow('# 書式: <パターン> ## <理由>\n#   例: policy|x ## Supabase 管理\n');
    expect(r.rules).toHaveLength(0);
    expect(r.invalid).toHaveLength(0);
  });

  it('🔴 理由が空の指定は無効（無視ではなく明示的にエラー）', () => {
    const r = parseAllow('policy|x ## ');
    expect(r.rules).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].why).toMatch(/理由/);
  });

  it('区切りの無い行は無効（黙って無視しない）', () => {
    const r = parseAllow('policy|x');
    expect(r.rules).toHaveLength(0);
    expect(r.invalid[0].why).toMatch(/##/);
  });

  it('"##" で始まる行はコメント（パターンが空になる行は構造上ここに落ちる）', () => {
    // trim 後に `#` 始まりなのでコメント。ルールにも無効行にもならない。
    const r = parseAllow('  ## 理由だけ書いた');
    expect(r.rules).toHaveLength(0);
    expect(r.invalid).toHaveLength(0);
  });

  it('理由付きの指定は有効になり、前方一致でマッチする', () => {
    const r = parseAllow('policy|realtime_ ## Supabase realtime が自動生成するため');
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0].reason).toBe('Supabase realtime が自動生成するため');
    expect(matchAllow('policy|realtime_x|cmd=r', r.rules)).not.toBeNull();
    expect(matchAllow('policy|other|cmd=r', r.rules)).toBeNull();
  });

  it('🔴 リポジトリにコミットされた除外ファイルは、有効ルール 0 本で無効行も 0 本', () => {
    // 除外を足すときは必ず理由を書くこと。ここが 0 でなくなったら、
    // 「本当に Supabase 管理のものか」をレビューで問う契機になる。
    const r = parseAllow(readFileSync(ALLOW_FILE, 'utf8'));
    expect(r.invalid).toHaveLength(0);
    expect(r.rules).toHaveLength(0);
  });
});
