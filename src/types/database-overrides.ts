import type { Database as GeneratedDatabase } from './database.types';

/**
 * Supabase クライアントへ配線する `Database` 型。生成物 `database.types.ts` に、機械生成では
 * 表現できない事実を最小限だけ上書きして重ねたもの。
 *
 * 🔴 なぜ生成ファイルを直接編集しないか: `database.types.ts` は本番 DB の introspection から
 * 再生成される。手で直しても次の再生成で黙って消え、消えたことに誰も気づかない。
 * 上書きは再生成の影響を受けないこのファイルに集約し、なぜ必要かを根拠付きで残す。
 *
 * ── 上書き 1: RPC `create_booking_atomic` の NULL 許容引数 ──
 *
 * PostgreSQL の関数引数には列のような NOT NULL 制約が存在しないため、Supabase の型生成器は
 * 「DEFAULT 句があるか」で optional を判定できても「NULL を渡してよいか」は判定できず、
 * SQL の型（uuid / text）をそのまま非 null の `string` にマッピングする。
 *
 * 実際の定義（supabase/migrations/20260717000001_booking_gate_after_g1.sql）は NULL を
 * 受け取る前提で書かれており、関数本体が明示的に分岐している：
 *
 *   IF p_staff_id IS NOT NULL THEN ...   -- 指名スタッフなし予約
 *   IF p_coupon_id IS NOT NULL THEN ...  -- クーポン未使用
 *
 * `p_user_id` / `p_email` / `p_phone` / `p_note` はそのまま bookings へ INSERT され、
 * 対応する列はいずれも NULL 許容（未ログインのゲスト予約・電話受付・備考なしが正常系）。
 *
 * つまり呼び出し側の `d.staff_id ?? null` は正しい実装であり、直すべきは型のほう。
 * 生成型のまま通そうとすると as / 非 null アサーションでの握りつぶしを強いられ、
 * `<Database>` を配線した目的（列名・型の取り違えを tsc で捕まえる）が失われる。
 *
 * ⚠️ 将来 Supabase の型生成器が関数引数の nullable を表現できるようになったら、この上書きは
 * 不要になる。`src/lib/__tests__/database-overrides.test.ts` が「上書きが今も必要か」を検査し、
 * 不要になった時点で気づけるようにしてある。
 */

type GeneratedFunctions = GeneratedDatabase['public']['Functions'];
type GeneratedCreateBooking = GeneratedFunctions['create_booking_atomic'];

/** NULL を渡してよいことが migration の本体で確認できている引数。 */
export const CREATE_BOOKING_NULLABLE_ARGS = [
  'p_staff_id',
  'p_user_id',
  'p_coupon_id',
  'p_email',
  'p_phone',
  'p_note',
] as const;

type CreateBookingNullableArg = (typeof CREATE_BOOKING_NULLABLE_ARGS)[number];

type CreateBookingArgs = Omit<GeneratedCreateBooking['Args'], CreateBookingNullableArg> & {
  [K in CreateBookingNullableArg]: string | null;
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Functions'> & {
    Functions: Omit<GeneratedFunctions, 'create_booking_atomic'> & {
      create_booking_atomic: Omit<GeneratedCreateBooking, 'Args'> & { Args: CreateBookingArgs };
    };
  };
};
