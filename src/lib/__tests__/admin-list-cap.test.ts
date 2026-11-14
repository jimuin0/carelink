import { ADMIN_LIST_FETCH, ADMIN_LIST_LIMIT, capAdminList } from '../admin-list-cap';

test('上限＋1 件で読む', () => {
  expect(ADMIN_LIST_FETCH).toBe(ADMIN_LIST_LIMIT + 1);
});

test('上限以下なら打ち切りなし', () => {
  const rows = Array.from({ length: ADMIN_LIST_LIMIT }, (_, i) => i);
  expect(capAdminList(rows)).toEqual({ rows, truncated: false });
});

test('上限を超えたら上限件に切り、打ち切りを知らせる', () => {
  const rows = Array.from({ length: ADMIN_LIST_FETCH }, (_, i) => i);
  const result = capAdminList(rows);
  expect(result.rows).toHaveLength(ADMIN_LIST_LIMIT);
  expect(result.truncated).toBe(true);
});

test('null / undefined は空', () => {
  expect(capAdminList(null)).toEqual({ rows: [], truncated: false });
  expect(capAdminList(undefined)).toEqual({ rows: [], truncated: false });
});
