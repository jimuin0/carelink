/**
 * `scripts/detect-added-migrations.mjs`（migration-apply-reminder ワークフローが使う
 * 「PR で新規追加された migration ファイル」検出ロジック）を機械で固定する。
 *
 * 実体は scripts/ 配下（jest.config.js の collectCoverageFrom は `scripts/**` を含まない
 * ＝ branches=100% ゲート対象外）。既存の `src/lib/__tests__/schema-diff-allow.test.ts` と
 * 同じ「動的 import でテストする」パターンをここでも使う。
 *
 * 検出方式は git diff の status 文字列（A/R/C/…）の列挙ではなく、base ツリーと HEAD
 * ツリーの migration ファイル集合の差分（`newMigrations`）。以下のテストは
 * 「status=A の列挙では見逃していたケース（rename-in / copy-in）を新方式が確実に
 * 拾うこと」と「拾い過ぎていないこと（modify / delete を新規と誤認しないこと）」の
 * 両方を証明する。
 */
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let isMigrationPath: (p: any) => boolean;
let migrationsInTree: (text: string) => string[];
let newMigrations: (baseText: string, headText: string) => string[];
let MIGRATIONS_DIR_PREFIX: string;

beforeAll(async () => {
  const mod = await import(join(ROOT, 'scripts', 'detect-added-migrations.mjs'));
  isMigrationPath = mod.isMigrationPath;
  migrationsInTree = mod.migrationsInTree;
  newMigrations = mod.newMigrations;
  MIGRATIONS_DIR_PREFIX = mod.MIGRATIONS_DIR_PREFIX;
});

describe('MIGRATIONS_DIR_PREFIX', () => {
  it('supabase/migrations/ を指す', () => {
    expect(MIGRATIONS_DIR_PREFIX).toBe('supabase/migrations/');
  });
});

describe('isMigrationPath', () => {
  it('supabase/migrations/*.sql を migration と認める', () => {
    expect(isMigrationPath('supabase/migrations/20260810000001_x.sql')).toBe(true);
  });

  it('プレフィックスが違えば対象外', () => {
    expect(isMigrationPath('supabase/shadow/20260810000001_x.sql')).toBe(false);
    expect(isMigrationPath('src/lib/foo.sql')).toBe(false);
  });

  it('拡張子が .sql でなければ対象外', () => {
    expect(isMigrationPath('supabase/migrations/README.md')).toBe(false);
  });

  it('ネストしたサブディレクトリは対象外', () => {
    expect(isMigrationPath('supabase/migrations/nested/x.sql')).toBe(false);
  });

  it('directory 自体（末尾がプレフィックスと同一）は対象外', () => {
    expect(isMigrationPath('supabase/migrations/')).toBe(false);
  });

  it('非文字列・空文字は対象外', () => {
    expect(isMigrationPath('')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isMigrationPath(undefined as any)).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isMigrationPath(123 as any)).toBe(false);
  });
});

describe('migrationsInTree', () => {
  it('migration パスだけを抽出する（非 migration・非 .sql は除外）', () => {
    const sample = [
      'supabase/migrations/20260811000002_add_widgets.sql',
      'README.md',
      'src/lib/schema-drift.ts',
    ].join('\n');
    expect(migrationsInTree(sample)).toEqual(['supabase/migrations/20260811000002_add_widgets.sql']);
  });

  it('ネストしたサブディレクトリのパスは除外する', () => {
    const sample = [
      'supabase/migrations/20260811000002_add_widgets.sql',
      'supabase/migrations/nested/20260811000003_x.sql',
    ].join('\n');
    expect(migrationsInTree(sample)).toEqual(['supabase/migrations/20260811000002_add_widgets.sql']);
  });

  it('重複を除去し、ソート済みで返す', () => {
    const sample = [
      'supabase/migrations/20260811000003_b.sql',
      'supabase/migrations/20260811000001_a.sql',
      'supabase/migrations/20260811000003_b.sql',
    ].join('\n');
    expect(migrationsInTree(sample)).toEqual([
      'supabase/migrations/20260811000001_a.sql',
      'supabase/migrations/20260811000003_b.sql',
    ]);
  });

  it('CRLF（末尾 \\r）と空行を許容する', () => {
    const sample = [
      'supabase/migrations/20260811000001_a.sql\r',
      '',
      '   ',
      'supabase/migrations/20260811000002_b.sql\r',
    ].join('\n');
    expect(migrationsInTree(sample)).toEqual([
      'supabase/migrations/20260811000001_a.sql',
      'supabase/migrations/20260811000002_b.sql',
    ]);
  });

  it('空文字・空行のみ・nullish 入力は空配列', () => {
    expect(migrationsInTree('')).toEqual([]);
    expect(migrationsInTree('\n\n')).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(migrationsInTree(undefined as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(migrationsInTree(null as any)).toEqual([]);
  });
});

describe('newMigrations（ドライラン: 想定される git ls-tree 出力の差分）', () => {
  it('検出できる: 純粋な新規追加（base に無く head にある）', () => {
    const base = ['supabase/migrations/20260722000001_old.sql'].join('\n');
    const head = [
      'supabase/migrations/20260722000001_old.sql',
      'supabase/migrations/20260811000002_add_widgets.sql',
    ].join('\n');
    expect(newMigrations(base, head)).toEqual(['supabase/migrations/20260811000002_add_widgets.sql']);
  });

  it('検出できる: リネームで migrations ディレクトリに「入ってきた」ファイル（旧 status=A 方式では見逃していたバグの再現）', () => {
    // base 側は非 migration パス（docs/x.sql）に存在し、supabase/migrations/ 配下には
    // まだ存在しない。旧実装は git diff の status='R' を無条件除外しており、
    // このケースを検出できなかった（本アップグレードが塞ぐ穴そのもの）。
    const base = ['docs/x.sql', 'supabase/migrations/20260722000001_old.sql'].join('\n');
    const head = [
      'supabase/migrations/20260722000001_old.sql',
      'supabase/migrations/20260811000004_renamed_in.sql',
    ].join('\n');
    expect(newMigrations(base, head)).toEqual(['supabase/migrations/20260811000004_renamed_in.sql']);
  });

  it('検出できる: コピーで migrations ディレクトリに「入ってきた」ファイル（ツリー差分の観点では rename-in と同一）', () => {
    // git diff 上は status='C' として現れ、これも旧実装では除外されていた。
    // ツリーの集合差分としては rename-in と区別が付かず（base に無く head にある）、
    // 同じロジックで検出される。
    const base = ['other/template.sql', 'supabase/migrations/20260722000001_old.sql'].join('\n');
    const head = [
      'supabase/migrations/20260722000001_old.sql',
      'supabase/migrations/20260811000005_copied_in.sql',
    ].join('\n');
    expect(newMigrations(base, head)).toEqual(['supabase/migrations/20260811000005_copied_in.sql']);
  });

  it('除外される: 変更のみ（base・head 両方に同一パスが存在＝内容が変わっただけ）', () => {
    const base = ['supabase/migrations/20260805000001_handle_new_user_merge.sql'].join('\n');
    const head = ['supabase/migrations/20260805000001_handle_new_user_merge.sql'].join('\n');
    expect(newMigrations(base, head)).toEqual([]);
  });

  it('除外される: 削除（base のみに存在、head には無い）', () => {
    const base = [
      'supabase/migrations/20260722000001_old.sql',
      'supabase/migrations/20260805000001_keep.sql',
    ].join('\n');
    const head = ['supabase/migrations/20260805000001_keep.sql'].join('\n');
    expect(newMigrations(base, head)).toEqual([]);
  });

  it('意図した安全側の挙動: migrations ディレクトリ内でのリネームは「新規」として報告される', () => {
    // old.sql → renamed.sql の単純リネーム。renamed.sql は base ツリーに存在しない
    // ため新規として報告される（old.sql は base のみに存在＝削除としてこの関数の
    // 対象外）。既に適用済みの migration をリネームするのは通常起こらない稀な操作で、
    // 過剰リマインド（安全側）に倒れるだけであり、日次 schema-drift-check は
    // ファイル名ではなくスキーマの実体（フィンガープリント）を見るため、この
    // ケースで誤って 🔴 を出すことはない。見逃し（under-report）より
    // 過剰通知（over-report）を選ぶ、という本ゲートの設計方針どおりの挙動。
    const base = ['supabase/migrations/20260805000001_old.sql'].join('\n');
    const head = ['supabase/migrations/20260805000002_renamed.sql'].join('\n');
    expect(newMigrations(base, head)).toEqual(['supabase/migrations/20260805000002_renamed.sql']);
  });

  it('複合ケース: 追加・rename-in・変更・削除が同時に起きても新規分だけを過不足なく拾う', () => {
    const base = [
      'supabase/migrations/20260701000001_keep_modified.sql',
      'supabase/migrations/20260701000002_will_delete.sql',
      'docs/rename-source.sql',
    ].join('\n');
    const head = [
      'supabase/migrations/20260701000001_keep_modified.sql', // 内容変更のみ・パスは同じ
      'supabase/migrations/20260811000010_added.sql',
      'supabase/migrations/20260811000011_renamed_in.sql',
    ].join('\n');
    expect(newMigrations(base, head)).toEqual([
      'supabase/migrations/20260811000010_added.sql',
      'supabase/migrations/20260811000011_renamed_in.sql',
    ]);
  });

  it('新規 migration が無ければ空配列（過剰検知しない = 拾い過ぎ方向のポジティブ確認）', () => {
    const base = ['supabase/migrations/20260701000001_a.sql'].join('\n');
    const head = ['supabase/migrations/20260701000001_a.sql'].join('\n');
    expect(newMigrations(base, head)).toEqual([]);
  });

  it('base 側が空（migrations ディレクトリが base に存在しない）でも head の migration を全件検出する', () => {
    const head = [
      'supabase/migrations/20260811000001_a.sql',
      'supabase/migrations/20260811000002_b.sql',
    ].join('\n');
    expect(newMigrations('', head)).toEqual([
      'supabase/migrations/20260811000001_a.sql',
      'supabase/migrations/20260811000002_b.sql',
    ]);
  });

  it('空文字・nullish 入力は空配列', () => {
    expect(newMigrations('', '')).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(newMigrations(undefined as any, undefined as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(newMigrations(null as any, null as any)).toEqual([]);
  });
});
