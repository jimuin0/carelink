/**
 * 管理画面の一覧で読み込む上限（最新から 100 件）。
 *
 * 以前は .limit(100) で黙って打ち切り、101 件目以降が存在すること自体が画面から分からなかった。
 * 上限より 1 件多く読み、超えていたら「最新の 100 件だけを表示している」と画面に出す。
 */
export const ADMIN_LIST_LIMIT = 100;

/** クエリの .limit() に渡す件数（上限＋1。超過を検知するため）。 */
export const ADMIN_LIST_FETCH = ADMIN_LIST_LIMIT + 1;

/** 上限＋1 件で読んだ結果を、表示する行と「打ち切ったか」に分ける。 */
export function capAdminList<T>(rows: readonly T[] | null | undefined): { rows: T[]; truncated: boolean } {
  const list = rows ?? [];
  return { rows: list.slice(0, ADMIN_LIST_LIMIT), truncated: list.length > ADMIN_LIST_LIMIT };
}
