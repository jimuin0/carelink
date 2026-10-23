/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * メニューの所要時間の規則（15〜480 分の整数・2026年10月23日）。画面の入力欄・API・予約枠の範囲が
 * 同じ数であることを固定する。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { hasMenuDurationIssue, MENU_DURATION_ERROR, menuDurationSchema } from '../menu-duration';

test.each([15, 60, 480])('%p 分は受け付ける', (minutes) => {
  expect(menuDurationSchema.safeParse(minutes).success).toBe(true);
});
test.each([0, 14, 481, 30.5, null, '60', Number.NaN])('%p は受け付けない', (minutes) => {
  expect(menuDurationSchema.safeParse(minutes).success).toBe(false);
});

test('所要時間の誤りだけを見分ける', () => {
  const schema = z.object({ name: z.string().min(1), duration_minutes: menuDurationSchema });
  const duration = schema.safeParse({ name: 'x', duration_minutes: 5 });
  const name = schema.safeParse({ name: '', duration_minutes: 60 });
  expect(!duration.success && hasMenuDurationIssue(duration.error)).toBe(true);
  expect(!name.success && hasMenuDurationIssue(name.error)).toBe(false);
});

test('画面の入力欄と同じ範囲・同じ文言', () => {
  expect(MENU_DURATION_ERROR).toBe('所要時間は15〜480分の整数で入力してください');
  const page = readFileSync(join(process.cwd(), 'src/app/admin/menus/page.tsx'), 'utf8');
  expect(page).toContain('const MENU_DURATION_MIN = 15;');
  expect(page).toContain('const MENU_DURATION_MAX = 480;');
  expect(page).toContain('所要時間は${MENU_DURATION_MIN}〜${MENU_DURATION_MAX}分の整数で入力してください');
});

test('HPB の取り込みはこの API を通らず、取り込み側の検証に従う', () => {
  const apply = readFileSync(join(process.cwd(), 'src/app/api/admin/hpb-menus/apply/route.ts'), 'utf8');
  expect(apply).not.toContain('menu-duration');
  expect(readFileSync(join(process.cwd(), 'src/lib/hpb-menu.ts'), 'utf8')).not.toContain('menu-duration');
});
