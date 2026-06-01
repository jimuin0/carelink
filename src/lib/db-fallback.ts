// マイグレーション未適用環境向けのフォールバックヘルパー。
// 追加カラムが DB に存在しない場合（PostgREST: PGRST204 / Postgres: 42703）に
// 当該カラムを除外して再試行するための共通判定・除外ユーティリティ。

export interface DbError {
  code?: string;
  message?: string;
}

/** カラム不在に起因するエラーか（null は false） */
export function isMissingColumnError(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST204' || error.code === '42703' || /column .* does not exist/i.test(error.message ?? '');
}

/** 指定キーを除外した浅いコピーを返す */
export function omitKeys<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Partial<T> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}
