import type { Json } from '@/types/database.types';

/**
 * 任意の値を、Supabase の jsonb 列（`<Database>` 型上は `Json`）へそのまま渡せる値に変換する。
 *
 * 🔴 なぜ必要か: `Json` は `string | number | boolean | null | { [k: string]: Json | undefined } | Json[]`
 * という閉じた型なので、`unknown` を含む型（Stripe SDK の Event 等）や、インデックスシグネチャを
 * 持たない `interface` で宣言された値は【構造的に代入できない】。`as` でキャストして黙らせると、
 * jsonb 列に何を入れているかを型で追えなくなり、Supabase クライアントへ `<Database>` 型を配線した
 * 目的そのものが消える。実行時に値の形を判定して JSON 互換値へ作り直すのが唯一の正しい解。
 *
 * 🔴 なぜ集約したか: 型配線の作業中、同一実装が6ファイル（audit-logger / webhook-queue /
 * cron-logger / ab-test / stripe-webhook / gbp-place）にそれぞれ書かれた。分岐が散在すると
 * 「どれか1つだけ挙動が変わる」事故が起きるうえ、テストも重複する。`src/lib/err.ts` の
 * `errorMessage` と同じ理由でここに一本化する。
 *
 * 挙動: `undefined` のプロパティは JSON.stringify と同じく落とす。関数・symbol・bigint など
 * JSON で表現できない値は `null` に倒す（jsonb 列に入れられる形にするのが目的のため）。
 */
export function toJsonValue(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === 'object') {
    const result: { [key: string]: Json | undefined } = {};
    for (const [key, v] of Object.entries(value)) {
      if (v !== undefined) result[key] = toJsonValue(v);
    }
    return result;
  }
  return null;
}
