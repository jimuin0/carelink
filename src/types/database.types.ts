export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      areas: {
        Row: {
          area_type: string
          id: string
          name: string
          parent_id: string | null
          slug: string
          sort_order: number | null
        }
        Insert: {
          area_type: string
          id?: string
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number | null
        }
        Update: {
          area_type?: string
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author_id: string | null
          content: string
          created_at: string | null
          facility_id: string
          id: string
          is_published: boolean | null
          published_at: string | null
          slug: string
          thumbnail_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          author_id?: string | null
          content: string
          created_at?: string | null
          facility_id?: string
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          slug: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string | null
          content?: string
          created_at?: string | null
          facility_id?: string
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          slug?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_date: string
          coupon_id: string | null
          created_at: string | null
          customer_name: string
          email: string
          end_time: string
          facility_id: string
          id: string
          menu_id: string | null
          note: string | null
          phone: string | null
          staff_id: string | null
          start_time: string
          status: string
          total_price: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          booking_date: string
          coupon_id?: string | null
          created_at?: string | null
          customer_name: string
          email: string
          end_time: string
          facility_id?: string
          id?: string
          menu_id?: string | null
          note?: string | null
          phone?: string | null
          staff_id?: string | null
          start_time: string
          status?: string
          total_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          booking_date?: string
          coupon_id?: string | null
          created_at?: string | null
          customer_name?: string
          email?: string
          end_time?: string
          facility_id?: string
          id?: string
          menu_id?: string | null
          note?: string | null
          phone?: string | null
          staff_id?: string | null
          start_time?: string
          status?: string
          total_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string | null
          email: string
          id: string
          inquiry_type: string
          message: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          inquiry_type: string
          message: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          inquiry_type?: string
          message?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      coupon_menus: {
        Row: {
          coupon_id: string
          id: string
          menu_id: string
        }
        Insert: {
          coupon_id?: string
          id?: string
          menu_id?: string
        }
        Update: {
          coupon_id?: string
          id?: string
          menu_id?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          coupon_type: string
          created_at: string | null
          description: string | null
          discount_type: string
          discount_value: number | null
          facility_id: string
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          special_price: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          coupon_type?: string
          created_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          facility_id?: string
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          special_price?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          coupon_type?: string
          created_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          facility_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          special_price?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      customer_visits: {
        Row: {
          amount: number | null
          booking_id: string | null
          created_at: string | null
          customer_email: string
          customer_name: string
          facility_id: string
          id: string
          menu_name: string | null
          note: string | null
          staff_name: string | null
          visit_date: string
        }
        Insert: {
          amount?: number | null
          booking_id?: string | null
          created_at?: string | null
          customer_email: string
          customer_name: string
          facility_id?: string
          id?: string
          menu_name?: string | null
          note?: string | null
          staff_name?: string | null
          visit_date: string
        }
        Update: {
          amount?: number | null
          booking_id?: string | null
          created_at?: string | null
          customer_email?: string
          customer_name?: string
          facility_id?: string
          id?: string
          menu_name?: string | null
          note?: string | null
          staff_name?: string | null
          visit_date?: string
        }
        Relationships: []
      }
      facilities: {
        Row: {
          address: string | null
          business_type: string
          contact_name: string
          created_at: string | null
          description: string | null
          email: string
          facility_name: string
          id: string
          phone: string
          postal_code: string | null
          representative_name: string
          status: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          business_type: string
          contact_name: string
          created_at?: string | null
          description?: string | null
          email: string
          facility_name: string
          id?: string
          phone: string
          postal_code?: string | null
          representative_name: string
          status?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          business_type?: string
          contact_name?: string
          created_at?: string | null
          description?: string | null
          email?: string
          facility_name?: string
          id?: string
          phone?: string
          postal_code?: string | null
          representative_name?: string
          status?: string | null
          website?: string | null
        }
        Relationships: []
      }
      facility_inquiries: {
        Row: {
          created_at: string | null
          email: string
          facility_id: string
          facility_name: string
          id: string
          message: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          facility_id?: string
          facility_name: string
          id?: string
          message: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          facility_id?: string
          facility_name?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      facility_members: {
        Row: {
          created_at: string | null
          facility_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          facility_id?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      facility_menus: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          facility_id: string
          id: string
          is_featured: boolean | null
          name: string
          price: number | null
          price_note: string | null
          sort_order: number | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          facility_id?: string
          id?: string
          is_featured?: boolean | null
          name: string
          price?: number | null
          price_note?: string | null
          sort_order?: number | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          facility_id?: string
          id?: string
          is_featured?: boolean | null
          name?: string
          price?: number | null
          price_note?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      facility_photos: {
        Row: {
          caption: string | null
          created_at: string | null
          facility_id: string
          id: string
          photo_type: string
          photo_url: string
          sort_order: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          photo_type: string
          photo_url: string
          sort_order?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          photo_type?: string
          photo_url?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      facility_profiles: {
        Row: {
          access_info: string | null
          address: string
          building: string | null
          business_hours: Json | null
          business_type: string
          catch_copy: string | null
          city: string
          created_at: string | null
          credit_card: boolean | null
          description: string | null
          features: string[] | null
          id: string
          latitude: number | null
          longitude: number | null
          main_photo_url: string | null
          name: string
          parking: boolean | null
          phone: string | null
          postal_code: string | null
          prefecture: string
          rating_avg: number | null
          rating_count: number | null
          regular_holiday: string | null
          seat_count: number | null
          slug: string
          staff_count: number | null
          status: string | null
          updated_at: string | null
          view_count: number | null
          website_url: string | null
        }
        Insert: {
          access_info?: string | null
          address: string
          building?: string | null
          business_hours?: Json | null
          business_type: string
          catch_copy?: string | null
          city: string
          created_at?: string | null
          credit_card?: boolean | null
          description?: string | null
          features?: string[] | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          main_photo_url?: string | null
          name: string
          parking?: boolean | null
          phone?: string | null
          postal_code?: string | null
          prefecture: string
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          seat_count?: number | null
          slug: string
          staff_count?: number | null
          status?: string | null
          updated_at?: string | null
          view_count?: number | null
          website_url?: string | null
        }
        Update: {
          access_info?: string | null
          address?: string
          building?: string | null
          business_hours?: Json | null
          business_type?: string
          catch_copy?: string | null
          city?: string
          created_at?: string | null
          credit_card?: boolean | null
          description?: string | null
          features?: string[] | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          main_photo_url?: string | null
          name?: string
          parking?: boolean | null
          phone?: string | null
          postal_code?: string | null
          prefecture?: string
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          seat_count?: number | null
          slug?: string
          staff_count?: number | null
          status?: string | null
          updated_at?: string | null
          view_count?: number | null
          website_url?: string | null
        }
        Relationships: []
      }
      facility_reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          facility_id: string
          id: string
          rating: number
          reviewer_name: string
          status: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          rating: number
          reviewer_name: string
          status?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          rating?: number
          reviewer_name?: string
          status?: string | null
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string | null
          facility_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          facility_id?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      job_postings: {
        Row: {
          benefits: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          description: string
          employment_type: string
          facility_name: string
          holidays: string | null
          id: string
          job_type: string
          location: string
          requirements: string | null
          salary: string
          status: string | null
          title: string
          working_hours: string | null
        }
        Insert: {
          benefits?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description: string
          employment_type: string
          facility_name: string
          holidays?: string | null
          id?: string
          job_type: string
          location: string
          requirements?: string | null
          salary: string
          status?: string | null
          title: string
          working_hours?: string | null
        }
        Update: {
          benefits?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string
          employment_type?: string
          facility_name?: string
          holidays?: string | null
          id?: string
          job_type?: string
          location?: string
          requirements?: string | null
          salary?: string
          status?: string | null
          title?: string
          working_hours?: string | null
        }
        Relationships: []
      }
      job_seekers: {
        Row: {
          address: string | null
          birth_date: string | null
          certifications: string[] | null
          created_at: string | null
          desired_employment_type: string[] | null
          desired_location: string | null
          desired_salary: string | null
          education: string | null
          email: string
          experience_years: number | null
          full_name: string
          furigana: string
          gender: string | null
          id: string
          job_type: string
          phone: string
          photo_url: string | null
          postal_code: string | null
          previous_job: string | null
          self_pr: string | null
          status: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          certifications?: string[] | null
          created_at?: string | null
          desired_employment_type?: string[] | null
          desired_location?: string | null
          desired_salary?: string | null
          education?: string | null
          email: string
          experience_years?: number | null
          full_name: string
          furigana: string
          gender?: string | null
          id?: string
          job_type: string
          phone: string
          photo_url?: string | null
          postal_code?: string | null
          previous_job?: string | null
          self_pr?: string | null
          status?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          certifications?: string[] | null
          created_at?: string | null
          desired_employment_type?: string[] | null
          desired_location?: string | null
          desired_salary?: string | null
          education?: string | null
          email?: string
          experience_years?: number | null
          full_name?: string
          furigana?: string
          gender?: string | null
          id?: string
          job_type?: string
          phone?: string
          photo_url?: string | null
          postal_code?: string | null
          previous_job?: string | null
          self_pr?: string | null
          status?: string | null
        }
        Relationships: []
      }
      menu_staff: {
        Row: {
          id: string
          menu_id: string
          staff_id: string
        }
        Insert: {
          id?: string
          menu_id?: string
          staff_id?: string
        }
        Update: {
          id?: string
          menu_id?: string
          staff_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          city: string | null
          created_at: string | null
          display_name: string
          email: string | null
          gender: string | null
          id: string
          phone: string | null
          prefecture: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          gender?: string | null
          id?: string
          phone?: string | null
          prefecture?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          gender?: string | null
          id?: string
          phone?: string | null
          prefecture?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      recruits: {
        Row: {
          address: string | null
          benefits: string | null
          business_type: string
          contact_name: string
          created_at: string | null
          desired_start_date: string | null
          email: string
          employment_type: string | null
          facility_name: string
          holidays: string | null
          id: string
          job_category: string
          phone: string
          photo_url: string | null
          postal_code: string | null
          pr_text: string | null
          representative_name: string
          requirements: string | null
          salary_range: string | null
          work_hours: string | null
        }
        Insert: {
          address?: string | null
          benefits?: string | null
          business_type: string
          contact_name: string
          created_at?: string | null
          desired_start_date?: string | null
          email: string
          employment_type?: string | null
          facility_name: string
          holidays?: string | null
          id?: string
          job_category: string
          phone: string
          photo_url?: string | null
          postal_code?: string | null
          pr_text?: string | null
          representative_name: string
          requirements?: string | null
          salary_range?: string | null
          work_hours?: string | null
        }
        Update: {
          address?: string | null
          benefits?: string | null
          business_type?: string
          contact_name?: string
          created_at?: string | null
          desired_start_date?: string | null
          email?: string
          employment_type?: string | null
          facility_name?: string
          holidays?: string | null
          id?: string
          job_category?: string
          phone?: string
          photo_url?: string | null
          postal_code?: string | null
          pr_text?: string | null
          representative_name?: string
          requirements?: string | null
          salary_range?: string | null
          work_hours?: string | null
        }
        Relationships: []
      }
      review_replies: {
        Row: {
          content: string
          created_at: string | null
          id: string
          review_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          review_id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: []
      }
      salons: {
        Row: {
          address: string | null
          business_hours: string | null
          business_type: string
          contact_name: string
          created_at: string | null
          desired_start_date: string | null
          email: string
          facility_name: string
          id: string
          is_public: boolean | null
          phone: string
          photo_url: string | null
          postal_code: string | null
          pr_text: string | null
          regular_holiday: string | null
          representative_name: string
          seat_count: number | null
          staff_count: number | null
          status: string | null
        }
        Insert: {
          address?: string | null
          business_hours?: string | null
          business_type: string
          contact_name: string
          created_at?: string | null
          desired_start_date?: string | null
          email: string
          facility_name: string
          id?: string
          is_public?: boolean | null
          phone: string
          photo_url?: string | null
          postal_code?: string | null
          pr_text?: string | null
          regular_holiday?: string | null
          representative_name: string
          seat_count?: number | null
          staff_count?: number | null
          status?: string | null
        }
        Update: {
          address?: string | null
          business_hours?: string | null
          business_type?: string
          contact_name?: string
          created_at?: string | null
          desired_start_date?: string | null
          email?: string
          facility_name?: string
          id?: string
          is_public?: boolean | null
          phone?: string
          photo_url?: string | null
          postal_code?: string | null
          pr_text?: string | null
          regular_holiday?: string | null
          representative_name?: string
          seat_count?: number | null
          staff_count?: number | null
          status?: string | null
        }
        Relationships: []
      }
      schedule_overrides: {
        Row: {
          date: string
          end_time: string | null
          id: string
          is_holiday: boolean | null
          staff_id: string
          start_time: string | null
        }
        Insert: {
          date: string
          end_time?: string | null
          id?: string
          is_holiday?: boolean | null
          staff_id?: string
          start_time?: string | null
        }
        Update: {
          date?: string
          end_time?: string | null
          id?: string
          is_holiday?: boolean | null
          staff_id?: string
          start_time?: string | null
        }
        Relationships: []
      }
      staff_photos: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          photo_type: string
          photo_url: string
          sort_order: number | null
          staff_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          photo_type?: string
          photo_url: string
          sort_order?: number | null
          staff_id?: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          photo_type?: string
          photo_url?: string
          sort_order?: number | null
          staff_id?: string
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          bio: string | null
          created_at: string | null
          facility_id: string
          id: string
          instagram_url: string | null
          is_active: boolean | null
          name: string
          photo_url: string | null
          position: string | null
          slug: string
          sort_order: number | null
          specialties: string[] | null
          updated_at: string | null
          years_experience: number | null
        }
        Insert: {
          bio?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          name: string
          photo_url?: string | null
          position?: string | null
          slug: string
          sort_order?: number | null
          specialties?: string[] | null
          updated_at?: string | null
          years_experience?: number | null
        }
        Update: {
          bio?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          name?: string
          photo_url?: string | null
          position?: string | null
          slug?: string
          sort_order?: number | null
          specialties?: string[] | null
          updated_at?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      staff_schedules: {
        Row: {
          day_of_week: number
          end_time: string
          id: string
          staff_id: string
          start_time: string
        }
        Insert: {
          day_of_week: number
          end_time: string
          id?: string
          staff_id?: string
          start_time: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          staff_id?: string
          start_time?: string
        }
        Relationships: []
      }
      treatment_catalogs: {
        Row: {
          after_photo_url: string | null
          before_photo_url: string | null
          created_at: string | null
          description: string | null
          facility_id: string
          id: string
          menu_id: string | null
          staff_id: string | null
          tags: string[] | null
          title: string
        }
        Insert: {
          after_photo_url?: string | null
          before_photo_url?: string | null
          created_at?: string | null
          description?: string | null
          facility_id?: string
          id?: string
          menu_id?: string | null
          staff_id?: string | null
          tags?: string[] | null
          title: string
        }
        Update: {
          after_photo_url?: string | null
          before_photo_url?: string | null
          created_at?: string | null
          description?: string | null
          facility_id?: string
          id?: string
          menu_id?: string | null
          staff_id?: string | null
          tags?: string[] | null
          title?: string
        }
        Relationships: []
      }
      user_points: {
        Row: {
          booking_id: string | null
          created_at: string | null
          id: string
          points: number
          reason: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          points: number
          reason: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          points?: number
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_view_count: {
        Args: { facility_uuid: string }
        Returns: undefined
      }
      get_available_slots: {
        Args: {
          p_facility_id: string
          p_staff_id: string
          p_date: string
          p_duration_minutes: number
        }
        Returns: { slot_start: string; slot_end: string }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
