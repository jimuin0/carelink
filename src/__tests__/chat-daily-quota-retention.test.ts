import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260921000001_chat_daily_rate_limit_retention.sql'),
  'utf8',
);

describe('anonymous chat rolling quota retention', () => {
  test('retains daily quota buckets for at least the full quota window', () => {
    expect(migration).toContain("'rate-limit-cleanup'");
    expect(migration).toMatch(/key LIKE 'chat-daily:%'[\s\S]*?INTERVAL '25 hours'/);
    expect(migration).toMatch(/key NOT LIKE 'chat-daily:%'[\s\S]*?INTERVAL '1 hour'/);
  });
});
