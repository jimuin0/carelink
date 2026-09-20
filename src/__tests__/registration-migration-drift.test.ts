import fs from 'node:fs';
import path from 'node:path';

const migrations = path.join(process.cwd(), 'supabase/migrations');
const registrationSql = fs.readFileSync(
  path.join(migrations, '20260919000007_salon_registration_reliability.sql'),
  'utf8',
);
const uploadsSql = fs.readFileSync(
  path.join(migrations, '20260920000002_carelink_uploads_bucket.sql'),
  'utf8',
);

describe('registration migrations reconcile known production drift', () => {
  test('catches up registration source without guessing historical origins', () => {
    expect(registrationSql).toContain('ADD COLUMN IF NOT EXISTS source text');
    expect(registrationSql).toContain("CHECK (source IS NULL OR source IN ('register', 'recruit'))");
    expect(registrationSql).not.toMatch(/UPDATE\s+public\.salons[\s\S]*\bsource\s*=/i);
  });

  test('updates existing upload limits while preserving bucket visibility', () => {
    expect(uploadsSql).toMatch(
      /ON CONFLICT \(id\) DO UPDATE\s+SET file_size_limit = EXCLUDED\.file_size_limit,\s+allowed_mime_types = EXCLUDED\.allowed_mime_types;/i,
    );
    expect(uploadsSql).not.toMatch(/SET[\s\S]*?\bpublic\s*=/i);
  });

  test('tightens either known anonymous policy to the image-only allowlist', () => {
    expect(uploadsSql).toContain("polname = 'Allow anonymous upload'");
    expect(uploadsSql).toContain("polname = 'Allow anonymous upload images only'");
    expect(uploadsSql.match(/storage\.extension\(name\) IN \('jpg', 'jpeg', 'png', 'webp', 'gif'\)/g)).toHaveLength(2);
    expect(uploadsSql).toContain('RAISE EXCEPTION');
    expect(uploadsSql).not.toMatch(/CREATE\s+POLICY/i);
  });
});
