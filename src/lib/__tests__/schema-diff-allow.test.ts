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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  diffFingerprint,
  SAME_DATABASE_MIN_OVERLAP,
  VACUOUS_MIN_ITEMS,
  VERSION_LINE_PREFIX,
} from '../schema-drift';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const ALLOW_FILE = join(ROOT, 'scripts', 'schema-drift-allow.txt');

let parseAllow: (t: string) => { rules: any[]; invalid: any[] };
let matchAllow: (l: string, r: any[]) => any;
let comparabilityProblem: (e: Set<string>, a: Set<string>, min: number) => string | null;
let CLI_MIN_OVERLAP: number;
let CLI_VERSION_PREFIX: string;

beforeAll(async () => {
  const mod = await import(join(ROOT, 'scripts', 'schema-diff.mjs'));
  parseAllow = mod.parseAllow;
  matchAllow = mod.matchAllow;
  comparabilityProblem = mod.comparabilityProblem;
  CLI_MIN_OVERLAP = mod.SAME_DATABASE_MIN_OVERLAP;
  CLI_VERSION_PREFIX = mod.VERSION_LINE_PREFIX;
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

describe('🔴 2 つの差分エンジンが安全側の挙動で食い違わないこと', () => {
  // engine は 2 本ある:
  //   ・src/lib/schema-drift.ts の diffFingerprint（cron が使う本番経路）
  //   ・scripts/schema-diff.mjs の comparabilityProblem（人が手で叩く調査用 CLI）
  // 障害調査で CLI を叩いた人が、cron とは違う結論（＝存在しないドリフト）に
  // たどり着く状態そのものが欠陥。しきい値と判定順序を機械で固定する。

  /** 突合が成立する十分な量のフィンガープリントを組み立てる。 */
  const build = (rels: string[], pad: string, major: string | null) => [
    ...(major === null ? [] : [`${CLI_VERSION_PREFIX}${major}`]),
    ...rels.map((r) => `relation|${r}|r|rls=t|force=f`),
    ...Array.from({ length: 600 }, (_, i) => `column|${pad}${i}.c|text|notnull=f|default=|generated=`),
  ];
  const S = (a: string[]) => new Set(a);
  const rels = Array.from({ length: 20 }, (_, i) => `t${i}`);

  it('しきい値が両エンジンで一致している', () => {
    expect(CLI_MIN_OVERLAP).toBe(SAME_DATABASE_MIN_OVERLAP);
    expect(CLI_VERSION_PREFIX).toBe(VERSION_LINE_PREFIX);
  });

  it('成立している突合では両エンジンとも何も主張しない', () => {
    const a = build(rels, 'a', '17');
    expect(comparabilityProblem(S(a), S(a), VACUOUS_MIN_ITEMS)).toBeNull();
    const r = diffFingerprint(a, a);
    expect(r.vacuous).toBe(false);
    expect(r.differentDatabase).toBeUndefined();
    expect(r.versionMismatch).toBeUndefined();
  });

  it('空振りを両エンジンとも止める', () => {
    const a = build(rels, 'a', '17').slice(0, 10);
    expect(comparabilityProblem(S(a), S(a), VACUOUS_MIN_ITEMS)).toMatch(/空振り/);
    expect(diffFingerprint(a, a).vacuous).toBe(true);
  });

  it('別 DB を両エンジンとも止める', () => {
    const exp = build(rels.map((r) => `carelink_${r}`), 'a', '17');
    const act = build(rels.map((r) => `soel_${r}`), 'b', '17');
    expect(comparabilityProblem(S(exp), S(act), VACUOUS_MIN_ITEMS)).toMatch(/別のデータベース/);
    expect(diffFingerprint(exp, act).differentDatabase).toBeDefined();
  });

  it('メジャーバージョン不一致を両エンジンとも止める', () => {
    // 実測 2026年8月3日: PG16 と PG17 は MAINTAIN 権限の有無で grant 行が 290 件ズレる。
    // 片方のエンジンだけがこれを通すと、290 件の「存在しないドリフト」が報告される。
    const exp = build(rels, 'a', '17');
    const act = build(rels, 'a', '16');
    expect(comparabilityProblem(S(exp), S(act), VACUOUS_MIN_ITEMS)).toMatch(/メジャーバージョン不一致/);
    expect(diffFingerprint(exp, act).versionMismatch).toEqual({ expected: '17', actual: '16' });
  });

  it('判定の優先順位が両エンジンで一致している（空振り → 別 DB → バージョン）', () => {
    // 別 DB かつバージョンも違う場合、両方とも「別 DB」と言わなければ
    // 調査が別方向に走る（原因の説明が食い違う）。
    const exp = build(rels.map((r) => `carelink_${r}`), 'a', '17');
    const act = build(rels.map((r) => `soel_${r}`), 'b', '16');
    expect(comparabilityProblem(S(exp), S(act), VACUOUS_MIN_ITEMS)).toMatch(/別のデータベース/);
    const r = diffFingerprint(exp, act);
    expect(r.differentDatabase).toBeDefined();
    expect(r.versionMismatch).toBeUndefined();
  });
});

describe('🔴 ガードが CLI 本体に配線されていること（関数が在るだけでは意味が無い）', () => {
  // 「ガードを書いた」と「ガードが効いている」は別。exports をテストしただけだと
  // main() から呼ばれていない状態を緑にしてしまう。実際にプロセスを起こして確かめる。
  const CLI = join(ROOT, 'scripts', 'schema-diff.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'schema-diff-'));

  const write = (name: string, lines: string[]) => {
    const f = join(dir, name);
    writeFileSync(f, lines.join('\n'), 'utf8');
    return f;
  };
  const build = (rels: string[], pad: string, major: string) => [
    `${VERSION_LINE_PREFIX}${major}`,
    ...rels.map((r) => `relation|${r}|r|rls=t|force=f`),
    ...Array.from({ length: 600 }, (_, i) => `column|${pad}${i}.c|text|notnull=f|default=|generated=`),
  ];
  const rels = Array.from({ length: 20 }, (_, i) => `t${i}`);

  /** CLI を起動して {code, out} を返す。 */
  const run = (a: string, b: string) => {
    try {
      const out = execFileSync('node', [CLI, a, b], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };

  it('一致していれば exit 0（負の対照: ガードが常時鳴るだけの実装を落とす）', () => {
    const a = write('same-a.txt', build(rels, 'a', '17'));
    const b = write('same-b.txt', build(rels, 'a', '17'));
    const r = run(a, b);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✅ スキーマ一致/);
  });

  it('本物のドリフトは従来どおり報告する', () => {
    const a = write('drift-a.txt', build(rels, 'a', '17'));
    const b = write('drift-b.txt', [...build(rels, 'a', '17'), 'index|t0|leaked|CREATE INDEX leaked']);
    const r = run(a, b);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/本番に【余分】/);
    expect(r.out).toMatch(/index\|t0\|leaked/);
  });

  it('🔴 メジャー不一致なら差分を 1 件も出さずに止まる', () => {
    // 実測: PG16↔PG17 は MAINTAIN 権限で grant 行が 290 件ズレる。
    // 配線されていなければ、その 290 件が「ドリフト」として出力されてしまう。
    const a = write('ver-a.txt', build(rels, 'a', '17'));
    const b = write('ver-b.txt', [...build(rels, 'a', '16'), 'index|t0|leaked|CREATE INDEX leaked']);
    const r = run(a, b);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/突合が成立していません/);
    expect(r.out).toMatch(/メジャーバージョン不一致/);
    expect(r.out).not.toMatch(/本番に【余分】/);
    expect(r.out).not.toMatch(/leaked/);
  });

  it('🔴 別 DB なら差分を 1 件も出さずに止まる', () => {
    const a = write('db-a.txt', build(rels.map((x) => `carelink_${x}`), 'a', '17'));
    const b = write('db-b.txt', build(rels.map((x) => `soel_${x}`), 'b', '17'));
    const r = run(a, b);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/別のデータベース/);
    expect(r.out).not.toMatch(/本番に【無い】/);
  });
});
