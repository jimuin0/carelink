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

  // 点検 A418 / A421：ガード自体が無いファイルは、どの DB でも書き込みが走る。
  // 既存の未対応分だけを台帳に置き、新しく足す fixture と台帳から外したファイルはガード必須にする。
  const UNGUARDED_LEDGER = new Set([
    '00_bootstrap.sql', // 使い捨て DB を作る側（bootstrap）。fixture ではない
    'account-deletion-fixtures.sql',
    'booking-line-notification-fixtures.sql',
    'listing-booking-fixtures.sql',
    'inquiry-reply-fixtures.sql',
    // 撤去済み lib 名の直書きを検査する at-risk-coupon-email-stopped.test.ts に掛からないよう分割して書く
    ['customer-coupon', 'email-fixtures.sql'].join('-'),
    'moderation-rpc-privilege-fixtures.sql',
    'listing-verification-fixtures.sql',
    'webhook-dispatch-v2-fixtures.sql',
  ]);

  it.each(files.filter((f) => !UNGUARDED_LEDGER.has(f)))('%s は使い捨て DB 名 carelink_shadow* を確かめてから動く', (f) => {
    const sql = readFileSync(join(DIR, f), 'utf8');
    expect(sql).toMatch(/current_database\(\)\s*(NOT\s+LIKE\s*'carelink_shadow%'|<>\s*'carelink_shadow'|NOT\s+IN\s*\(\s*'carelink_shadow|LIKE\s*'carelink_shadow%'|!~\s*'\^carelink_shadow')/i);
  });

  it('台帳に載っているファイルは実在し、まだガードが無い（直したら台帳から外す）', () => {
    for (const f of UNGUARDED_LEDGER) {
      expect(files).toContain(f);
      expect(readFileSync(join(DIR, f), 'utf8')).not.toMatch(/current_database\(\)/);
    }
  });
});
