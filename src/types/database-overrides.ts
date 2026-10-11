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
// The online wrapper passes these same six nullable fields to the unchanged
// core RPC. SQL function introspection cannot infer that explicit NULL path.
type OnlineBookingArgs = Omit<GeneratedFunctions['create_online_booking_atomic']['Args'], CreateBookingNullableArg> & {
  [K in CreateBookingNullableArg]: string | null;
};
type BookingScopeFunctionName = 'prepare_booking_create_operation' | 'inspect_booking_create_operation' | 'lock_booking_create_scope';
type NullableBookingScopeFunction<K extends BookingScopeFunctionName> = Omit<GeneratedFunctions[K], 'Args'> & {
  Args: Omit<GeneratedFunctions[K]['Args'], 'p_actor_id' | 'p_guest_hash'> & {
    p_actor_id: string | null; p_guest_hash: string | null;
  };
};

export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Functions' | 'Tables'> & {
    // Production-introspected tables are authoritative. The service photo
    // manifest permits only immutable, server-derived preparation inserts.
    Tables: Omit<GeneratedDatabase['public']['Tables'], 'salon_submission_photos'> & {
      salon_submission_photos: Omit<GeneratedDatabase['public']['Tables']['salon_submission_photos'], 'Insert' | 'Update'> & {
        Insert: { intent_id: string; selection_id: string; slot: number; mime_type: string; byte_size: number };
        Update: never;
      };
    };
    // Omit every overridden key before replacing it. Intersecting generated
    // non-null strings with nullable overrides would silently reject valid SQL NULLs.
    Functions: Omit<GeneratedFunctions, 'create_booking_atomic' | 'create_online_booking_atomic' | 'prepare_salon_photo' | 'setup_facility_from_registration' | 'save_booking_email_event_atomic' | 'start_booking_email_event' | 'checkout_booking_with_points_atomic' | 'moderate_content_atomic' | 'save_staff_override_atomic' | 'get_staff_mutation_operation' | BookingScopeFunctionName | 'create_booking_with_receipt_atomic'> & {
      // The gateway accepts either a verified actor or a signed guest scope,
      // not both. Its SQL body also permits no staff/coupon/phone/note.
      prepare_booking_create_operation: NullableBookingScopeFunction<'prepare_booking_create_operation'>;
      inspect_booking_create_operation: NullableBookingScopeFunction<'inspect_booking_create_operation'>;
      lock_booking_create_scope: NullableBookingScopeFunction<'lock_booking_create_scope'>;
      create_booking_with_receipt_atomic: Omit<GeneratedFunctions['create_booking_with_receipt_atomic'], 'Args'> & {
        Args: Omit<GeneratedFunctions['create_booking_with_receipt_atomic']['Args'], 'p_actor_id' | 'p_guest_hash' | 'p_staff_id' | 'p_coupon_id' | 'p_phone' | 'p_note'> & {
          p_actor_id: string | null; p_guest_hash: string | null; p_staff_id: string | null;
          p_coupon_id: string | null; p_phone: string | null; p_note: string | null;
        };
      };
      // These NULL paths are explicit in the forward atomicity migrations.
      checkout_booking_with_points_atomic: Omit<GeneratedFunctions['checkout_booking_with_points_atomic'], 'Args'> & {
        Args: Omit<GeneratedFunctions['checkout_booking_with_points_atomic']['Args'], 'p_expected_updated_at' | 'p_paid_amount'> & {
          p_expected_updated_at: string | null; p_paid_amount: number | null;
        };
      };
      moderate_content_atomic: Omit<GeneratedFunctions['moderate_content_atomic'], 'Args'> & {
        Args: Omit<GeneratedFunctions['moderate_content_atomic']['Args'], 'p_review_note' | 'p_expected_reviewed_at'> & { p_review_note?: string | null; p_expected_reviewed_at?: string | null };
      };
      save_staff_override_atomic: Omit<GeneratedFunctions['save_staff_override_atomic'], 'Args'> & {
        Args: Omit<GeneratedFunctions['save_staff_override_atomic']['Args'], 'p_start_time' | 'p_end_time'> & {
          p_start_time: string | null; p_end_time: string | null;
        };
      };
      get_staff_mutation_operation: Omit<GeneratedFunctions['get_staff_mutation_operation'], 'Args'> & {
        Args: Omit<GeneratedFunctions['get_staff_mutation_operation']['Args'], 'p_staff_id'> & { p_staff_id?: string | null };
      };
      start_booking_email_event: Omit<GeneratedFunctions['start_booking_email_event'], 'Returns'> & {
        Returns: { outcome: string; started_at: string | null }[];
      };
      // A NULL new status is an adjustment event; NULL envelope means no
      // customer email/internal arrival. SQL explicitly handles NULL revisions.
      save_booking_email_event_atomic: Omit<GeneratedFunctions['save_booking_email_event_atomic'], 'Args' | 'Returns'> & {
        Args: Omit<GeneratedFunctions['save_booking_email_event_atomic']['Args'], 'p_new_status' | 'p_envelope' | 'p_expected_updated_at'> & {
          p_new_status: string | null; p_envelope: GeneratedDatabase['public']['Tables']['webhook_retry_queue']['Row']['payload'] | null;
          p_expected_updated_at: string | null;
        };
        Returns: { operation_id: string | null; replayed: boolean; notification: string }[];
      };
      create_booking_atomic: Omit<GeneratedCreateBooking, 'Args'> & { Args: CreateBookingArgs };
      create_online_booking_atomic: Omit<GeneratedFunctions['create_online_booking_atomic'], 'Args'> & { Args: OnlineBookingArgs };
      // Production migration 20260930075129 and setup 20260930075358.
      // Introspection omits SQL NULLability for function parameters/results.
      // These NULL paths are explicit in the RPC bodies; generated-schema
      // existence remains checked independently by Contract tests.
      prepare_salon_photo: {
        Args: { p_intent_id: string; p_proof_hash: string; p_selection_id: string;
          p_slot: number; p_mime_type: string; p_byte_size: number };
        Returns: { outcome: string; photo_id: string | null; object_path: string | null }[];
      };
      setup_facility_from_registration: {
        Args: { p_user_id: string; p_claim_mode: 'none' | 'legacy' | 'intent' | 'recovered';
          p_receipt_id: string | null; p_intent_id: string | null; p_proof_hash: string | null;
          p_legacy_issued_at: string | null; p_profile: GeneratedDatabase['public']['Tables']['webhook_retry_queue']['Row']['payload'];
          p_license_warranted: boolean };
        Returns: { outcome: string; facility_id: string | null; facility_slug: string | null }[];
      };
    };
  };
};
