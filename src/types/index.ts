import type { BusinessDay } from '@/lib/business-hours';
// 予約ステータスは booking-status.ts を単一の真実とする（BookingStatus は全7値）。
// 以前ここで 5 値の独自 union を再定義し arrived / cancel_fee_paid が欠落していた（DB CHECK 制約と乖離）。
import type { BookingStatus } from '@/lib/booking-status';

export interface Salon {
  id: string;
  created_at: string;
  facility_name: string;
  business_type: string;
  representative_name: string;
  contact_name: string;
  email: string;
  phone: string;
  postal_code: string | null;
  address: string | null;
  business_hours: string | null;
  regular_holiday: string | null;
  seat_count: number | null;
  staff_count: number | null;
  pr_text: string | null;
  photo_url: string | null;
  desired_start_date: string | null;
  status: string;
  is_public: boolean;
}

export interface Contact {
  id: string;
  created_at: string;
  name: string;
  email: string;
  inquiry_type: string;
  message: string;
}

export type SalonFormData = Omit<Salon, 'id' | 'created_at' | 'status' | 'photo_url'> & {
  photo?: FileList;
};

export type ContactFormData = Omit<Contact, 'id' | 'created_at'>;

// Facility (公開用施設プロフィール)
export interface Facility {
  medical_specialties?: string[];
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  slug: string;
  business_type: string;
  catch_copy: string | null;
  description: string | null;
  postal_code: string | null;
  prefecture: string;
  city: string;
  address: string;
  building: string | null;
  latitude: number | null;
  longitude: number | null;
  access_info: string | null;
  phone: string | null;
  website_url: string | null;
  business_hours: Record<string, BusinessDay | null> | null;
  show_business_status?: boolean;
  regular_holiday: string | null;
  seat_count: number | null;
  staff_count: number | null;
  parking: boolean;
  credit_card: boolean;
  features: string[];
  nearest_station: string | null;
  rating_avg: number;
  rating_count: number;
  google_rating: number | null;
  google_review_count: number;
  gbp_place_id: string | null;
  gbp_cid: string | null;
  main_photo_url: string | null;
  view_count: number;
  status: 'draft' | 'published' | 'suspended';
  is_verified: boolean;
  verified_type: 'phone' | 'identity' | 'site_visit' | null;
  verified_at: string | null;
}

export interface FacilitySuggestion {
  id: string;
  name: string;
  slug: string;
  city: string;
  nearest_station: string | null;
  business_type: string;
}

export interface FacilityMenu {
  id: string;
  facility_id: string;
  category: string;
  name: string;
  description: string | null;
  price: number | null;
  price_note: string | null;
  duration_minutes: number | null;
  photo_url: string | null;
  is_featured: boolean;
  is_published?: boolean | null;
  sort_order: number;
  insurance_covered?: boolean;
  insurance_note?: string | null;
  insurance_price?: number | null;
  hpb_ref_id?: string | null;
}

export interface FacilityPhoto {
  id: string;
  facility_id: string;
  photo_url: string;
  photo_type: 'main' | 'interior' | 'exterior' | 'staff' | 'menu' | 'other';
  caption: string | null;
  sort_order: number;
}

export interface FacilityCardData {
  id: string;
  slug: string;
  name: string;
  business_type: string;
  catch_copy: string | null;
  prefecture: string;
  city: string;
  access_info: string | null;
  rating_avg: number;
  rating_count: number;
  google_rating: number | null;
  google_review_count: number;
  main_photo_url: string | null;
  min_price: number | null;
  max_price: number | null;
  menu_count: number;
  coupon_count: number;
  photo_count: number;
  business_hours: Record<string, BusinessDay | null> | null;
  special_hours?: { closed_dates: string[]; close_on_public_holidays: boolean; reception_cutoff_minutes: number | null } | null;
  seat_count: number | null;
  /** Online-booking readiness inputs from facility_card_view (see isCardBookingReady). */
  booking_menu_count?: number | null;
  active_staff_count?: number | null;
  has_address?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  distance?: number;
}

export interface FacilityReview {
  id: string;
  facility_id: string;
  user_id: string | null;
  reviewer_name: string;
  rating: number;
  rating_skill: number | null;
  rating_service: number | null;
  rating_atmosphere: number | null;
  rating_cleanliness: number | null;
  rating_explanation: number | null;
  comment: string | null;
  photo_urls: string[] | null;
  is_verified_visit: boolean | null;
  status: 'published' | 'hidden';
  created_at: string;
  /**
   * アカウントに紐づく投稿か（public_reviews だけが返す・user_id IS NOT NULL）。
   * 投稿者名は本人が入力したニックネームをそのまま公開するため、なりすまし対策として
   * 口コミ一覧で「会員」バッジを出すのに使う。user_id 自体は公開ビューに出さない。
   * migration 20261022130000 適用前は存在しないので省略可能にしてある。
   */
  is_member?: boolean | null;
}

export interface FacilityInquiry {
  id: string;
  facility_id: string;
  facility_name: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  created_at: string;
}

export interface SearchParams {
  keyword?: string;
  type?: string;
  prefecture?: string;
  city?: string;
  rating_min?: number;
  price_min?: number;
  price_max?: number;
  features?: string[];
  /** 対応症状の名前（symptoms.name）。facility_symptoms で対応を登録した施設に絞る。 */
  symptom?: string;
  /** true なら保険適用（insurance_covered）の公開メニューを持つ施設に絞る。 */
  insurance?: boolean;
  sort?: 'rating' | 'newest' | 'popular';
  page?: number;
  lat?: number;
  lng?: number;
  available_date?: string;
  available_time?: string;
}

// User Profile（認証ユーザー）
export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  prefecture: string | null;
  city: string | null;
  birth_date: string | null;
  gender: 'male' | 'female' | 'other' | 'unspecified' | null;
  created_at: string;
  updated_at: string;
}

// Favorite（お気に入り）
export interface Favorite {
  id: string;
  user_id: string;
  facility_id: string;
  created_at: string;
}

// Area（エリア階層）
export interface Area {
  id: string;
  name: string;
  slug: string;
  area_type: 'region' | 'prefecture' | 'city' | 'station';
  parent_id: string | null;
  sort_order: number;
}

// Staff（スタッフ）
export interface StaffProfile {
  id: string;
  facility_id: string;
  name: string;
  slug: string;
  position: string | null;
  bio: string | null;
  specialties: string[];
  years_experience: number | null;
  photo_url: string | null;
  instagram_url: string | null;
  nomination_fee: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StaffPhoto {
  id: string;
  staff_id: string;
  photo_url: string;
  caption: string | null;
  photo_type: 'portfolio' | 'before_after';
  sort_order: number;
  created_at: string;
}

// Coupon（クーポン）
export interface Coupon {
  id: string;
  facility_id: string;
  name: string;
  description: string | null;
  coupon_type: 'new_customer' | 'repeat' | 'limited_time' | 'all';
  discount_type: 'fixed' | 'percentage' | 'special_price';
  discount_value: number | null;
  special_price: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface CouponMenu {
  id: string;
  coupon_id: string;
  menu_id: string;
}

export interface MenuStaff {
  id: string;
  menu_id: string;
  staff_id: string;
}

// Booking（予約）
export interface Booking {
  id: string;
  facility_id: string;
  user_id: string | null;
  staff_id: string | null;
  /** true: 指名なし（おまかせ）。staff_id は予約 RPC が割り当てた担当で、指名ではない。 */
  staff_auto_assigned?: boolean;
  menu_id: string | null;
  coupon_id: string | null;
  booking_date: string;
  end_date?: string | null;
  start_time: string;
  end_time: string;
  customer_name: string;
  email: string;
  phone: string | null;
  note: string | null;
  status: BookingStatus;
  /** ポイント利用後の金額（お客様がお店で払う額）。 */
  total_price: number | null;
  /** 予約時にお客様が使った CareLink ポイント（1pt＝1円）。total_price からは差し引き済み。 */
  points_used?: number | null;
  /** お客様によるキャンセルのキャンセル料の算出材料（cancel RPC が保存・src/lib/cancel-fee-receipt.ts で読む）。 */
  cancel_fee_context?: unknown;
  created_at: string;
  updated_at: string;
}

export interface StaffSchedule {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface ScheduleOverride {
  id: string;
  staff_id: string;
  date: string;
  is_holiday: boolean;
  start_time: string | null;
  end_time: string | null;
}

export interface AvailableSlot {
  slot_start: string;
  slot_end: string;
  end_date?: string;
  staff_id?: string;
}

// Admin（管理）
export interface FacilityMember {
  id: string;
  user_id: string;
  facility_id: string;
  role: 'owner' | 'admin' | 'staff';
  created_at: string;
}

export interface CustomerVisit {
  id: string;
  facility_id: string;
  booking_id: string | null;
  customer_email: string | null;
  customer_name: string;
  visit_date: string;
  menu_name: string | null;
  staff_name: string | null;
  amount: number | null;
  note: string | null;
  created_at: string | null;
}

// Treatment Catalog（ヘアカタログ）
export interface TreatmentCatalog {
  id: string;
  facility_id: string;
  staff_id: string | null;
  menu_id: string | null;
  title: string;
  description: string | null;
  before_photo_url: string | null;
  after_photo_url: string | null;
  tags: string[];
  created_at: string;
}

// Blog（ブログ）
export interface BlogPost {
  id: string;
  facility_id: string;
  author_id: string | null;
  title: string;
  slug: string;
  content: string;
  thumbnail_url: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// Review Reply（口コミ返信）
export interface ReviewReply {
  id: string;
  review_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

// User Points（ポイント）
export interface UserPoint {
  id: string;
  user_id: string;
  points: number;
  reason: string;
  booking_id: string | null;
  created_at: string;
}
