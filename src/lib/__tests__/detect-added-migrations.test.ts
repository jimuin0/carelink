/**
 * `scripts/detect-added-migrations.mjs`（migration-apply-reminder ワークフローが使う
 * 「PR で新規追加された migration ファイル」検出ロジック）を機械で固定する。
 *
 * 実体は scripts/ 配下（jest.config.js の collectCoverageFrom は `scripts/**` を含まない
 * ＝ branches=100% ゲート対象外）。既存の `src/lib/__tests__/schema-diff-allow.test.ts` と
 * 同じ「動的 import でテストする」パターンをここでも使う。
 */
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let isMigrationPath: (p: any) => boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseNameStatusLine: (l: any) => { status: string; path: string } | null;
let addedMigrations: (text: string) => string[];
let MIGRATIONS_DIR_PREFIX: string;

beforeAll(async () => {
  const mod = await import(join(ROOT, 'scripts', 'detect-added-migrations.mjs'));
  isMigrationPath = mod.isMigrationPath;
  parseNameStatusLine = mod.parseNameStatusLine;
  addedMigrations = mod.addedMigrations;
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

describe('parseNameStatusLine', () => {
  it('通常の追加行をパースする', () => {
    expect(parseNameStatusLine('A\tsupabase/migrations/x.sql')).toEqual({
      status: 'A',
      path: 'supabase/migrations/x.sql',
    });
  });

  it('変更・削除もステータス文字を保つ', () => {
    expect(parseNameStatusLine('M\tsupabase/migrations/x.sql')?.status).toBe('M');
    expect(parseNameStatusLine('D\tsupabase/migrations/x.sql')?.status).toBe('D');
  });

  it('リネーム（類似度サフィックス付き）は新パスを path として扱う', () => {
    expect(
      parseNameStatusLine('R100\tsupabase/migrations/old.sql\tsupabase/migrations/new.sql'),
    ).toEqual({ status: 'R', path: 'supabase/migrations/new.sql' });
  });

  it('末尾の \\r を除去する（CRLF 由来）', () => {
    expect(parseNameStatusLine('A\tsupabase/migrations/x.sql\r')).toEqual({
      status: 'A',
      path: 'supabase/migrations/x.sql',
    });
  });

  it('空行・空文字は null', () => {
    expect(parseNameStatusLine('')).toBeNull();
    expect(parseNameStatusLine('   ')).toBeNull();
  });

  it('タブ区切りが無い行（不正形式）は null', () => {
    expect(parseNameStatusLine('A')).toBeNull();
  });

  it('非文字列は null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseNameStatusLine(undefined as any)).toBeNull();
  });
});

describe('addedMigrations（ドライラン: 想定される git diff --name-status 出力）', () => {
  it('新規追加された migration だけを抽出する', () => {
    const sample = [
      'A\tsupabase/migrations/20260811000002_add_widgets.sql',
      'M\tsrc/lib/schema-drift.ts',
      'D\tsupabase/migrations/20260722000001_old.sql',
      'A\tsrc/app/api/health/route.ts',
      'A\tsupabase/migrations/20260811000003_add_gadgets.sql',
      'M\tsupabase/migrations/20260805000001_handle_new_user_merge.sql',
    ].join('\n');

    expect(addedMigrations(sample)).toEqual([
      'supabase/migrations/20260811000002_add_widgets.sql',
      'supabase/migrations/20260811000003_add_gadgets.sql',
    ]);
  });

  it('migration の追加が無ければ空配列', () => {
    const sample = ['M\tsrc/lib/schema-drift.ts', 'A\tREADME.md'].join('\n');
    expect(addedMigrations(sample)).toEqual([]);
  });

  it('空文字・空行のみの入力は空配列', () => {
    expect(addedMigrations('')).toEqual([]);
    expect(addedMigrations('\n\n')).toEqual([]);
  });

  it('リネームで migration に「入ってきた」ファイルは追加として拾わない（status=A のみが対象）', () => {
    const sample = 'R100\tdocs/x.sql\tsupabase/migrations/20260811000004_renamed.sql';
    expect(addedMigrations(sample)).toEqual([]);
  });

  it('nullish 入力は空配列（fail-closed ではなく素直に何もしない）', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(addedMigrations(undefined as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(addedMigrations(null as any)).toEqual([]);
  });
});
