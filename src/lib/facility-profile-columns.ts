/**
 * facility_profiles をブラウザ権限（anon / authenticated）で読むときの列の単一ソース。
 *
 * 点検 B9-1（2026年11月13日）で、Stripe Connect の接続先 `stripe_account_id` を anon / authenticated から
 * 読めなくするため、facility_profiles の SELECT 権を「表単位」から「列単位」に切り替えた
 * （migration `20261113110100_facility_profiles_hide_stripe_account.sql`）。
 *
 * 🔴 列単位 GRANT の下では `select('*')` は権限エラー（42501）になる。anon / authenticated の
 * クライアントで facility_profiles を読むときは必ずこの定数を使い、`*` を書かないこと。
 * 🔴 facility_profiles に列を足したら、(1) migration で anon / authenticated へ
 * `GRANT SELECT (新しい列) ON public.facility_profiles TO anon, authenticated` を書き、
 * (2) この一覧にも足す。`src/__tests__/facility-profile-columns.test.ts` が
 * schema-snapshot.json との突合で (2) の漏れを CI で止める。
 * stripe_account_id は 2026年11月14日に列ごと撤去した（migration 20261114120000・決済は PAY.JP へ移行）。
 * 隠す列は今は無いが、列単位 GRANT の形は残している（新しく隠したい列が出たときにそのまま使えるように）。
 */
export const FACILITY_PROFILE_READABLE_COLUMNS =
  'access_info, address, board_slot_minutes, booking_auto_confirm, booking_buffer_minutes, building, business_hours, business_hours_text, business_type, catch_copy, city, created_at, credit_card, deposit_amount, deposit_type, description, design_color, design_template, directions, equipment, features, gbp_cid, gbp_connected_at, gbp_place_id, gbp_synced_at, genres, google_rating, google_review_count, header_photo_url, hpb_scraped_at, hpb_sln_id, id, is_seed, is_verified, latitude, location, logo_url, longitude, main_photo_url, medical_specialties, menu_remarks, name, nearest_station, onboarding_email_sent_at, owner_message, owner_name, owner_photo_url, owner_title, parking, parking_text, payment_other, phone, postal_code, prefecture, rating_avg, rating_count, regular_holiday, remarks, seat_count, show_business_status, slug, staff_breakdown, staff_count, status, updated_at, verified_at, verified_type, view_count, website_url';
