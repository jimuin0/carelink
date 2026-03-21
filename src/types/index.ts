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
}

export interface JobSeeker {
  id: string;
  created_at: string;
  full_name: string;
  furigana: string;
  birth_date: string | null;
  gender: string | null;
  postal_code: string | null;
  address: string | null;
  phone: string;
  email: string;
  job_type: string;
  certifications: string[] | null;
  experience_years: number | null;
  education: string | null;
  previous_job: string | null;
  desired_employment_type: string[] | null;
  desired_location: string | null;
  desired_salary: string | null;
  self_pr: string | null;
  photo_url: string | null;
  status: string;
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

export type JobSeekerFormData = Omit<JobSeeker, 'id' | 'created_at' | 'status' | 'photo_url'> & {
  photo?: FileList;
};

export type ContactFormData = Omit<Contact, 'id' | 'created_at'>;

// Facility (公開用施設プロフィール)
export interface Facility {
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
  business_hours: Record<string, { open: string; close: string } | null> | null;
  regular_holiday: string | null;
  seat_count: number | null;
  staff_count: number | null;
  parking: boolean;
  credit_card: boolean;
  features: string[];
  rating_avg: number;
  rating_count: number;
  main_photo_url: string | null;
  status: 'draft' | 'published' | 'suspended';
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
  is_featured: boolean;
  sort_order: number;
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
  main_photo_url: string | null;
}

export interface FacilityReview {
  id: string;
  facility_id: string;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  status: 'published' | 'hidden';
  created_at: string;
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
  sort?: 'rating' | 'newest';
  page?: number;
}
