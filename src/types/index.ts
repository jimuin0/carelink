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
