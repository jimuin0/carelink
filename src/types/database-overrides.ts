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
  public: Omit<GeneratedDatabase['public'], 'Functions' | 'Tables'> & {
    // Candidate schema only; the production introspection/Contract gate must
    // remain red until the actual schema and migration history are reconciled.
    Tables: Omit<GeneratedDatabase['public']['Tables'], 'salons'> & {
      salons: Omit<GeneratedDatabase['public']['Tables']['salons'], 'Row' | 'Insert' | 'Update'> & {
        Row: GeneratedDatabase['public']['Tables']['salons']['Row'] & { claimed_facility_id: string | null };
        Insert: GeneratedDatabase['public']['Tables']['salons']['Insert'] & { claimed_facility_id?: string | null };
        Update: GeneratedDatabase['public']['Tables']['salons']['Update'] & { claimed_facility_id?: string | null };
      };
      salon_submission_photos: {
        Row: { id: string; intent_id: string; selection_id: string; slot: number;
          mime_type: string; byte_size: number; object_path: string; created_at: string };
        Insert: { intent_id: string; selection_id: string; slot: number; mime_type: string; byte_size: number };
        Update: never;
        Relationships: [];
      };
    };
    Functions: Omit<GeneratedFunctions, 'create_booking_atomic'> & {
      create_booking_atomic: Omit<GeneratedCreateBooking, 'Args'> & { Args: CreateBookingArgs };
      // Candidate migration 20260926000003. This typed, feature-gated consumer
      // is NOT evidence of production application. Keep the production drift
      // tests against database.types.ts; reconcile from introspection before
      // enabling the route or merging a deployment that depends on this RPC.
      prepare_salon_photo: {
        Args: { p_intent_id: string; p_proof_hash: string; p_selection_id: string;
          p_slot: number; p_mime_type: string; p_byte_size: number };
        Returns: { outcome: string; photo_id: string | null; object_path: string | null }[];
      };
      setup_facility_from_registration: {
        Args: { p_user_id: string; p_claim_mode: 'none' | 'legacy' | 'intent';
          p_receipt_id: string | null; p_intent_id: string | null; p_proof_hash: string | null;
          p_legacy_issued_at: string | null; p_profile: GeneratedDatabase['public']['Tables']['webhook_retry_queue']['Row']['payload'];
          p_license_warranted: boolean };
        Returns: { outcome: string; facility_id: string | null; facility_slug: string | null }[];
      };
    };
  };
};
