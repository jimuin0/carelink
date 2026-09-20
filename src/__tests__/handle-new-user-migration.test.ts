/**
 * handle_new_user の前進migrationは、password登録とOAuth登録のどちらでも
 * profiles の必須プロフィール情報を失わないことを静的に固定する。
 */
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260919000008_handle_new_user_oauth_profile_fields.sql',
);

describe('handle_new_user OAuth profile migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  test('OAuth fallback、avatar、phone、prefectureを同じINSERTで保存する', () => {
    expect(sql).toContain('INSERT INTO public.profiles (id, display_name, email, avatar_url, phone, prefecture)');
    expect(sql).toContain("NULLIF(NEW.raw_user_meta_data->>'display_name', '')");
    expect(sql).toContain("NULLIF(NEW.raw_user_meta_data->>'full_name', '')");
    expect(sql).toContain("NULLIF(NEW.raw_user_meta_data->>'name', '')");
    expect(sql).toContain("NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '')");
    expect(sql).toContain("NULLIF(NEW.raw_user_meta_data->>'avatar_url', '')");
    expect(sql).toContain("NEW.raw_user_meta_data->>'phone'");
    expect(sql).toContain("NEW.raw_user_meta_data->>'prefecture'");
  });

  test('security definerの安全なsearch_pathを維持し、既存ユーザーのbackfillを含めない', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO 'public', 'extensions', 'pg_temp'");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    expect(sql).not.toMatch(/UPDATE\s+(?:public\.)?profiles/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+profiles[\s\S]*SELECT/i);
  });
});
