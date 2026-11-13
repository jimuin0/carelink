/**
 * URL のクエリは同じキーが複数あると配列で届く（例: ?keyword=a&keyword=b）。
 * ページ側が string 前提で .split() 等を呼ぶと TypeError で 500 になるため、
 * 先頭の値だけを使う形へ揃える（監査 B8-M2）。
 */
export function firstSearchParams<T extends object>(raw: T): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[key] = first;
  }
  return out as { [K in keyof T]?: string };
}
