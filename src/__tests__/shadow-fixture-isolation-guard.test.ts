/**
 * supabase/shadow/*.sql は合成データを書き込み、一時トリガ・ALTER TABLE ... DISABLE TRIGGER まで行う。
 * 本番 Supabase の DB 名も `postgres` で `supabase_admin` ロールも在り、application_name は
 * 接続側が自由に名乗れるため、どれも「隔離 DB である」根拠にならない。
 * 以前は 8 本がこれらを根拠に `postgres` を許可しており、本番へ誤って流すと書き込みが通った。
 * 隔離の根拠は使い捨て DB 名 `carelink_shadow*` だけに限る（CI もこの名前で実行している）。
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(process.cwd(), 'supabase/shadow');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));

describe('shadow fixture の隔離ガード', () => {
  it('走査対象が空振りしていない', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s は本番と同名の DB `postgres` を隔離先として許可しない', (f) => {
    const sql = readFileSync(join(DIR, f), 'utf8');
    expect(sql).not.toMatch(/current_database\(\)\s*=\s*'postgres'/);
    expect(sql).not.toMatch(/current_database\(\)\s*(NOT\s+)?IN\s*\([^)]*'postgres'/i);
  });
});
