/**
 * 指名スタッフの登録手段が実在し、書き込みが 1 本の API に集まっていることを固定する（2026年10月22日）。
 *
 * 🔴 なぜ必要か
 * マイページの「指名スタッフ」は「施設のスタッフページから『指名登録』できます」と案内していたが、
 * そのボタンはどこにも無く、user_preferred_staff へ行を足すコードもアプリ全体に 1 つも無かった
 * （＝タブは誰にとっても永久に空）。案内文だけが残って実体が消える、を再発させない。
 *
 * また、RLS（user_id = auth.uid()）は「自分の行か」しか見ないので、ブラウザから直接 INSERT すると
 * 非表示のスタッフや非公開施設のスタッフまで指名できる。書き込みは /api/preferred-staff に限る。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const API = 'src/app/api/preferred-staff/route.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** user_preferred_staff への書き込み（同じ文の中で insert/delete/upsert/update まで繋がっているもの） */
const WRITE = /from\(\s*['"`]user_preferred_staff['"`]\s*\)[^;]*\.(insert|delete|upsert|update)\(/;

describe('指名スタッフの登録手段', () => {
  it('スタッフ詳細とスタッフ一覧のカードに「指名登録」ボタンがある', () => {
    expect(read('src/app/facility/[slug]/staff/[staffSlug]/page.tsx')).toMatch(/<PreferredStaffButton\b/);
    expect(read('src/components/facility/StaffCard.tsx')).toMatch(/<PreferredStaffButton\b/);
    // 一覧は Provider 1 つで状態をまとめて読む
    expect(read('src/components/facility/StaffList.tsx')).toMatch(/<PreferredStaffProvider\b/);
    // ボタンの見える文言が、マイページの案内と同じ「指名登録」である
    expect(read('src/components/facility/PreferredStaffButton.tsx')).toMatch(/'指名登録'/);
    expect(read('src/app/mypage/staff/page.tsx')).toMatch(/「指名登録」ボタン/);
  });

  it('施設ページのスタッフタブは、ログイン後の戻り先に #staff を付ける', () => {
    // タブは押しても URL の #hash が変わらないため、付けないとログイン後に「トップ」タブへ戻される
    expect(read('src/app/facility/[slug]/page.tsx')).toMatch(/<StaffList\b[^>]*returnHash="#staff"/);
    expect(read('src/components/facility/StaffList.tsx')).toMatch(/<PreferredStaffProvider\b[^\n]*returnHash=\{returnHash\}/);
  });

  it('ボタンは書き込みを API に任せ、API は CSRF・レート制限・ログイン必須で包まれている', () => {
    expect(read('src/components/facility/PreferredStaffButton.tsx')).toMatch(/fetch\('\/api\/preferred-staff'/);
    const api = read(API);
    expect(api).toMatch(/withRoute\(/);
    expect(api).toMatch(/requireAuth:\s*true/);
    expect(api).toMatch(/csrf:\s*true/);
    expect(api).toMatch(/rateLimit:/);
    // 登録時は在籍・公開を確かめる
    expect(api).toMatch(/\.eq\('is_active', true\)/);
    expect(api).toMatch(/\.eq\('status', 'published'\)/);
  });

  it('検出器は旧実装のブラウザ直書きを検出できる（負の対照）', () => {
    expect(WRITE.test("await supabase.from('user_preferred_staff').delete().eq('id', id);")).toBe(true);
    expect(WRITE.test("supabase.from('user_preferred_staff').insert({ user_id, staff_id })")).toBe(true);
    expect(WRITE.test("supabase.from('user_preferred_staff').select('id, staff_id').eq('user_id', u);")).toBe(false);
  });

  it('user_preferred_staff へ書き込むのは /api/preferred-staff だけ', () => {
    const files = sourceFiles(join(ROOT, 'src')).map((f) => relative(ROOT, f).split('\\').join('/'));
    expect(files.length).toBeGreaterThan(300);
    const writers = files.filter((f) => WRITE.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(writers).toEqual([API]);
  });
});
