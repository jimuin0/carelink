/**
 * 本番側 RPC `get_schema_fingerprint()` の本文が、shadow 側で使う
 * `scripts/schema-fingerprint.sql` と **1 文字も違わない**ことを強制する。
 *
 * 🔴 なぜ要るか（2026年8月2日）:
 *   この監視は「migration を全適用した使い捨て DB」と「本番」を、同一の SQL で
 *   同じ形に落として突合することで成立している。両者がズレた瞬間、差分は
 *   「本番のドリフト」ではなく「SQL の書き方の違い」を映すただのノイズになり、
 *   検知として死ぬ。片方だけ直す改修が物理的にできないようにする。
 *
 * 実際、設計中に **search_path の違いだけで全 FK と全 geography 列が差分になる**
 * 事象を踏んだ（`SET search_path=''` の関数では pg_get_constraintdef が
 * `public.` を付けて修飾するため）。方式を 1 本に固定する必要性の実証。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const FP_SQL = join(ROOT, 'scripts', 'schema-fingerprint.sql');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const BEGIN = '-- >>> BEGIN scripts/schema-fingerprint.sql（自動転記・手で編集しない） >>>';
const END = '-- <<< END scripts/schema-fingerprint.sql <<<';

/** `get_schema_fingerprint` を定義している最新の migration を返す。 */
function latestFingerprintMigration(): { name: string; text: string } {
  const hits = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) =>
      readFileSync(join(MIGRATIONS, f), 'utf8').includes(
        'FUNCTION public.get_schema_fingerprint',
      ),
    )
    .sort();
  expect(hits.length).toBeGreaterThan(0); // 走査が空振りしていないことの下限
  const name = hits[hits.length - 1];
  return { name, text: readFileSync(join(MIGRATIONS, name), 'utf8') };
}

/** 比較用の正規化。改行コードと行末空白だけを吸収し、中身は一切変えない。 */
function normalize(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

describe('get_schema_fingerprint RPC と schema-fingerprint.sql の同一性', () => {
  it('RPC 本文に転記マーカーが存在する', () => {
    const { text } = latestFingerprintMigration();
    expect(text).toContain(BEGIN);
    expect(text).toContain(END);
  });

  it('転記されたクエリが scripts/schema-fingerprint.sql と完全一致する', () => {
    const { name, text } = latestFingerprintMigration();
    const start = text.indexOf(BEGIN) + BEGIN.length;
    const end = text.indexOf(END);
    const embedded = normalize(text.slice(start, end));

    const file = readFileSync(FP_SQL, 'utf8');
    const queryStart = file.indexOf('WITH ext_objs AS (');
    expect(queryStart).toBeGreaterThanOrEqual(0); // 走査が空振りしていないことの下限
    const source = normalize(file.slice(queryStart).replace(/;\s*$/, ''));

    expect(embedded).toBe(
      source,
    );
    expect(embedded.length).toBeGreaterThan(1000); // 空文字同士の「一致」を許さない
    expect(name).toMatch(/\.sql$/);
  });

  it('RPC が service_role 限定で公開されている（anon/authenticated からは実行不可）', () => {
    const { text } = latestFingerprintMigration();
    expect(text).toContain('REVOKE ALL ON FUNCTION public.get_schema_fingerprint() FROM PUBLIC');
    expect(text).toContain(
      'REVOKE ALL ON FUNCTION public.get_schema_fingerprint() FROM anon, authenticated',
    );
    expect(text).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_schema_fingerprint() TO service_role',
    );
  });

  it('RPC が SECURITY DEFINER かつ search_path 固定である', () => {
    const { text } = latestFingerprintMigration();
    expect(text).toContain('SECURITY DEFINER');
    expect(text).toContain("SET search_path = ''");
  });

  it('🔴 負の対照: 転記が 1 文字でも違えば不一致になる', () => {
    const file = readFileSync(FP_SQL, 'utf8');
    const source = normalize(file.slice(file.indexOf('WITH ext_objs AS (')).replace(/;\s*$/, ''));
    const tampered = source.replace('pg_policy', 'pg_policy ');
    expect(tampered).not.toBe(source);
  });
});

describe('照合順序に依存しない並び（誤報の構造的除去）', () => {
  it('🔴 ORDER BY に COLLATE "C" が付いている', () => {
    // 2026年8月2日: CI が実装欠陥を検出した。`ORDER BY line` は DB の LC_COLLATE に
    // 依存し、ローカル shadow(C.UTF-8) と CI(en_US.utf8) で **中身が完全に同一なのに
    // 218 行が並び順だけズレて差分**になった。本番 Supabase の照合順序は環境依存なので、
    // 放置すれば永続的な誤報源になる。COLLATE "C" はバイト順で環境非依存。
    const sql = readFileSync(FP_SQL, 'utf8');
    expect(sql).toMatch(/ORDER BY line COLLATE "C"/);
  });

  it('🔴 RPC 側の jsonb_agg にも COLLATE "C" が付いている', () => {
    // 片方だけだと本番と shadow で並びが変わり、同じ誤報が復活する。
    const { text } = latestFingerprintMigration();
    expect(text).toMatch(/jsonb_agg\(q\.line ORDER BY q\.line COLLATE "C"\)/);
  });

  it('🔴 生成器も取得時と比較時の両方で並びを C に固定している', () => {
    const sh = readFileSync(join(ROOT, 'scripts', 'gen-schema-fingerprint.sh'), 'utf8');
    expect(sh).toMatch(/ORDER BY value COLLATE/);
    expect(sh).toMatch(/LC_ALL=C sort/);
  });
});
