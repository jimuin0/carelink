/**
 * 管理画面の一覧を上限で黙って打ち切らない（点検 B7-7）。
 * 上限＋1 件で読み、超えたら注記を出す配線が 5 画面すべてに残っていることを固定する。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const PAGES = ['facility-inquiries', 'qa', 'blog', 'photos', 'moderation'];

test.each(PAGES)('/admin/%s は上限＋1 件で読み、打ち切りを画面に出す', (name) => {
  const src = readFileSync(join(process.cwd(), 'src/app/admin', name, 'page.tsx'), 'utf8');
  expect(src).not.toMatch(/\.limit\(100\)/);
  expect(src).toMatch(/\.limit\(ADMIN_LIST_FETCH\)/);
  expect(src).toMatch(/capAdminList\(/);
  expect(src).toMatch(/<AdminListCapNotice truncated=\{/);
});
