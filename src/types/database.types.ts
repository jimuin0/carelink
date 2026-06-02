export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      area_seo_contents: {
        Row: {
          body_text: string
          business_type_slug: string | null
          city_slug: string | null
          created_at: string | null
          faq_items: Json | null
          h2_title: string | null
          id: string
          prefecture_slug: string
          updated_at: string | null
        }
        Insert: {
          body_text: string
          business_type_slug?: string | null
          city_slug?: string | null
          created_at?: string | null
          faq_items?: Json | null
          h2_title?: string | null
          id?: string
          prefecture_slug: string
          updated_at?: string | null
        }
        Update: {
          body_text?: string
          business_type_slug?: string | null
          city_slug?: string | null
          created_at?: string | null
          faq_items?: Json | null
          h2_title?: string | null
          id?: string
          prefecture_slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
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
        Relationships: [
          {
            foreignKeyName: "areas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_authors: {
        Row: {
          created_at: string | null
          facility_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          facility_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_authors_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_authors_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string | null
          author_name_id: string | null
          category: string | null
          content: string
          coupon_id: string | null
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
          author_name_id?: string | null
          category?: string | null
          content: string
          coupon_id?: string | null
          created_at?: string | null
          facility_id: string
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
          author_name_id?: string | null
          category?: string | null
          content?: string
          coupon_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_author_name_id_fkey"
            columns: ["author_name_id"]
            isOneToOne: false
            referencedRelation: "blog_authors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_menus: {
        Row: {
          booking_id: string
          duration_minutes: number | null
          id: string
          menu_id: string
          name: string
          price: number | null
          sort_order: number | null
        }
        Insert: {
          booking_id: string
          duration_minutes?: number | null
          id?: string
          menu_id: string
          name: string
          price?: number | null
          sort_order?: number | null
        }
        Update: {
          booking_id?: string
          duration_minutes?: number | null
          id?: string
          menu_id?: string
          name?: string
          price?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_menus_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          coupon_id: string | null
          created_at: string | null
          customer_name: string
          email: string | null
          end_time: string
          facility_id: string
          id: string
          menu_id: string | null
          note: string | null
          paid_amount: number | null
          payment_status: string | null
          phone: string | null
          points_used: number | null
          source: string
          staff_id: string | null
          start_time: string
          status: string
          stripe_payment_intent_id: string | null
          total_price: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          booking_date: string
          coupon_id?: string | null
          created_at?: string | null
          customer_name: string
          email?: string | null
          end_time: string
          facility_id: string
          id?: string
          menu_id?: string | null
          note?: string | null
          paid_amount?: number | null
          payment_status?: string | null
          phone?: string | null
          points_used?: number | null
          source?: string
          staff_id?: string | null
          start_time: string
          status?: string
          stripe_payment_intent_id?: string | null
          total_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          booking_date?: string
          coupon_id?: string | null
          created_at?: string | null
          customer_name?: string
          email?: string | null
          end_time?: string
          facility_id?: string
          id?: string
          menu_id?: string | null
          note?: string | null
          paid_amount?: number | null
          payment_status?: string | null
          phone?: string | null
          points_used?: number | null
          source?: string
          staff_id?: string | null
          start_time?: string
          status?: string
          stripe_payment_intent_id?: string | null
          total_price?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_read: boolean | null
          room_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          room_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          room_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_rooms: {
        Row: {
          created_at: string | null
          facility_id: string
          id: string
          last_message_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          facility_id: string
          id?: string
          last_message_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          last_message_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_rooms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_rooms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          coupon_id: string
          id?: string
          menu_id: string
        }
        Update: {
          coupon_id?: string
          id?: string
          menu_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_menus_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          coupon_type: string
          created_at: string | null
          description: string | null
          discount_type: string
          discount_value: number | null
          duration_minutes: number | null
          facility_id: string
          id: string
          is_active: boolean | null
          name: string
          presentation_timing: string | null
          search_category1: string | null
          search_category2: string | null
          sort_order: number | null
          special_price: number | null
          usage_condition: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          coupon_type?: string
          created_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          duration_minutes?: number | null
          facility_id: string
          id?: string
          is_active?: boolean | null
          name: string
          presentation_timing?: string | null
          search_category1?: string | null
          search_category2?: string | null
          sort_order?: number | null
          special_price?: number | null
          usage_condition?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          coupon_type?: string
          created_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number | null
          duration_minutes?: number | null
          facility_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          presentation_timing?: string | null
          search_category1?: string | null
          search_category2?: string | null
          sort_order?: number | null
          special_price?: number | null
          usage_condition?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          customer_email: string
          customer_name: string | null
          facility_id: string
          first_visit_date: string | null
          id: string
          last_visit_date: string | null
          segment: string | null
          total_spent: number | null
          total_visits: number | null
          updated_at: string | null
        }
        Insert: {
          customer_email: string
          customer_name?: string | null
          facility_id: string
          first_visit_date?: string | null
          id?: string
          last_visit_date?: string | null
          segment?: string | null
          total_spent?: number | null
          total_visits?: number | null
          updated_at?: string | null
        }
        Update: {
          customer_email?: string
          customer_name?: string | null
          facility_id?: string
          first_visit_date?: string | null
          id?: string
          last_visit_date?: string | null
          segment?: string | null
          total_spent?: number | null
          total_visits?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_segments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          facility_id: string
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
        Relationships: [
          {
            foreignKeyName: "customer_visits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_visits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_visits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_revenue_summary: {
        Row: {
          booking_count: number | null
          cancelled_count: number | null
          completed_count: number | null
          created_at: string | null
          date: string
          facility_id: string
          id: string
          new_customer_count: number | null
          no_show_count: number | null
          repeat_customer_count: number | null
          total_revenue: number | null
        }
        Insert: {
          booking_count?: number | null
          cancelled_count?: number | null
          completed_count?: number | null
          created_at?: string | null
          date: string
          facility_id: string
          id?: string
          new_customer_count?: number | null
          no_show_count?: number | null
          repeat_customer_count?: number | null
          total_revenue?: number | null
        }
        Update: {
          booking_count?: number | null
          cancelled_count?: number | null
          completed_count?: number | null
          created_at?: string | null
          date?: string
          facility_id?: string
          id?: string
          new_customer_count?: number | null
          no_show_count?: number | null
          repeat_customer_count?: number | null
          total_revenue?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_revenue_summary_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_summary_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      facility_cancel_policies: {
        Row: {
          created_at: string | null
          facility_id: string
          free_cancel_hours: number | null
          id: string
          late_cancel_rate: number | null
          no_show_rate: number | null
          policy_text: string | null
        }
        Insert: {
          created_at?: string | null
          facility_id: string
          free_cancel_hours?: number | null
          id?: string
          late_cancel_rate?: number | null
          no_show_rate?: number | null
          policy_text?: string | null
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          free_cancel_hours?: number | null
          id?: string
          late_cancel_rate?: number | null
          no_show_rate?: number | null
          policy_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_cancel_policies_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_cancel_policies_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_certifications: {
        Row: {
          certification_name: string
          facility_id: string
          id: string
          license_number: string | null
          sort_order: number | null
          staff_name: string | null
        }
        Insert: {
          certification_name: string
          facility_id: string
          id?: string
          license_number?: string | null
          sort_order?: number | null
          staff_name?: string | null
        }
        Update: {
          certification_name?: string
          facility_id?: string
          id?: string
          license_number?: string | null
          sort_order?: number | null
          staff_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_certifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_certifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          facility_id: string
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
        Relationships: [
          {
            foreignKeyName: "facility_inquiries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_inquiries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_jobs: {
        Row: {
          benefits: string | null
          created_at: string
          description: string | null
          employment_type: string | null
          facility_id: string
          id: string
          is_seed: boolean | null
          job_type: string | null
          requirements: string | null
          salary_max: number | null
          salary_min: number | null
          salary_note: string | null
          title: string
          updated_at: string
        }
        Insert: {
          benefits?: string | null
          created_at?: string
          description?: string | null
          employment_type?: string | null
          facility_id: string
          id?: string
          is_seed?: boolean | null
          job_type?: string | null
          requirements?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_note?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          benefits?: string | null
          created_at?: string
          description?: string | null
          employment_type?: string | null
          facility_id?: string
          id?: string
          is_seed?: boolean | null
          job_type?: string | null
          requirements?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_note?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_jobs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_jobs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_line_settings: {
        Row: {
          created_at: string | null
          facility_id: string
          id: string
          notify_on_booking: boolean | null
          notify_on_cancel: boolean | null
          reminder_enabled: boolean | null
          reminder_hours_before: number | null
        }
        Insert: {
          created_at?: string | null
          facility_id: string
          id?: string
          notify_on_booking?: boolean | null
          notify_on_cancel?: boolean | null
          reminder_enabled?: boolean | null
          reminder_hours_before?: number | null
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          notify_on_booking?: boolean | null
          notify_on_cancel?: boolean | null
          reminder_enabled?: boolean | null
          reminder_hours_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_line_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_line_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          facility_id: string
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
        Relationships: [
          {
            foreignKeyName: "facility_members_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_members_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_menus: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          duration_minutes: number | null
          facility_id: string
          id: string
          insurance_covered: boolean | null
          insurance_note: string | null
          insurance_price: number | null
          is_featured: boolean | null
          is_published: boolean | null
          name: string
          photo_url: string | null
          price: number | null
          price_ask: boolean | null
          price_note: string | null
          price_show_tilde: boolean | null
          reservable: boolean | null
          search_category: string | null
          sort_order: number | null
          subcategory: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          facility_id: string
          id?: string
          insurance_covered?: boolean | null
          insurance_note?: string | null
          insurance_price?: number | null
          is_featured?: boolean | null
          is_published?: boolean | null
          name: string
          photo_url?: string | null
          price?: number | null
          price_ask?: boolean | null
          price_note?: string | null
          price_show_tilde?: boolean | null
          reservable?: boolean | null
          search_category?: string | null
          sort_order?: number | null
          subcategory?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          facility_id?: string
          id?: string
          insurance_covered?: boolean | null
          insurance_note?: string | null
          insurance_price?: number | null
          is_featured?: boolean | null
          is_published?: boolean | null
          name?: string
          photo_url?: string | null
          price?: number | null
          price_ask?: boolean | null
          price_note?: string | null
          price_show_tilde?: boolean | null
          reservable?: boolean | null
          search_category?: string | null
          sort_order?: number | null
          subcategory?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_menus_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_menus_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_notification_settings: {
        Row: {
          created_at: string | null
          email_daily_summary: boolean | null
          email_weekly_report: boolean | null
          facility_id: string
          id: string
          push_on_cancel: boolean | null
          push_on_new_booking: boolean | null
          push_on_review: boolean | null
        }
        Insert: {
          created_at?: string | null
          email_daily_summary?: boolean | null
          email_weekly_report?: boolean | null
          facility_id: string
          id?: string
          push_on_cancel?: boolean | null
          push_on_new_booking?: boolean | null
          push_on_review?: boolean | null
        }
        Update: {
          created_at?: string | null
          email_daily_summary?: boolean | null
          email_weekly_report?: boolean | null
          facility_id?: string
          id?: string
          push_on_cancel?: boolean | null
          push_on_new_booking?: boolean | null
          push_on_review?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_notification_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_notification_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_photos: {
        Row: {
          caption: string | null
          coupon_id: string | null
          created_at: string | null
          facility_id: string
          genre: string | null
          id: string
          image_submission: boolean | null
          is_published: boolean | null
          photo_type: string
          photo_url: string
          search_category: string | null
          sort_order: number | null
          title: string | null
        }
        Insert: {
          caption?: string | null
          coupon_id?: string | null
          created_at?: string | null
          facility_id: string
          genre?: string | null
          id?: string
          image_submission?: boolean | null
          is_published?: boolean | null
          photo_type: string
          photo_url: string
          search_category?: string | null
          sort_order?: number | null
          title?: string | null
        }
        Update: {
          caption?: string | null
          coupon_id?: string | null
          created_at?: string | null
          facility_id?: string
          genre?: string | null
          id?: string
          image_submission?: boolean | null
          is_published?: boolean | null
          photo_type?: string
          photo_url?: string
          search_category?: string | null
          sort_order?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_photos_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_photos_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_photos_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_profiles: {
        Row: {
          access_info: string | null
          address: string
          building: string | null
          business_hours: Json | null
          business_hours_text: string | null
          business_type: string
          catch_copy: string | null
          city: string
          created_at: string | null
          credit_card: boolean | null
          description: string | null
          design_color: string | null
          design_template: string | null
          directions: string | null
          equipment: Json | null
          features: string[] | null
          genres: string[] | null
          google_rating: number | null
          google_review_count: number | null
          header_photo_url: string | null
          id: string
          is_seed: boolean | null
          latitude: number | null
          location: unknown
          logo_url: string | null
          longitude: number | null
          main_photo_url: string | null
          menu_remarks: string | null
          name: string
          owner_message: string | null
          owner_name: string | null
          owner_photo_url: string | null
          owner_title: string | null
          parking: boolean | null
          parking_text: string | null
          payment_other: string | null
          phone: string | null
          postal_code: string | null
          prefecture: string
          rating_avg: number | null
          rating_count: number | null
          regular_holiday: string | null
          remarks: string | null
          seat_count: number | null
          slug: string
          staff_breakdown: Json | null
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
          business_hours_text?: string | null
          business_type: string
          catch_copy?: string | null
          city: string
          created_at?: string | null
          credit_card?: boolean | null
          description?: string | null
          design_color?: string | null
          design_template?: string | null
          directions?: string | null
          equipment?: Json | null
          features?: string[] | null
          genres?: string[] | null
          google_rating?: number | null
          google_review_count?: number | null
          header_photo_url?: string | null
          id?: string
          is_seed?: boolean | null
          latitude?: number | null
          location?: unknown
          logo_url?: string | null
          longitude?: number | null
          main_photo_url?: string | null
          menu_remarks?: string | null
          name: string
          owner_message?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          owner_title?: string | null
          parking?: boolean | null
          parking_text?: string | null
          payment_other?: string | null
          phone?: string | null
          postal_code?: string | null
          prefecture: string
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          remarks?: string | null
          seat_count?: number | null
          slug: string
          staff_breakdown?: Json | null
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
          business_hours_text?: string | null
          business_type?: string
          catch_copy?: string | null
          city?: string
          created_at?: string | null
          credit_card?: boolean | null
          description?: string | null
          design_color?: string | null
          design_template?: string | null
          directions?: string | null
          equipment?: Json | null
          features?: string[] | null
          genres?: string[] | null
          google_rating?: number | null
          google_review_count?: number | null
          header_photo_url?: string | null
          id?: string
          is_seed?: boolean | null
          latitude?: number | null
          location?: unknown
          logo_url?: string | null
          longitude?: number | null
          main_photo_url?: string | null
          menu_remarks?: string | null
          name?: string
          owner_message?: string | null
          owner_name?: string | null
          owner_photo_url?: string | null
          owner_title?: string | null
          parking?: boolean | null
          parking_text?: string | null
          payment_other?: string | null
          phone?: string | null
          postal_code?: string | null
          prefecture?: string
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          remarks?: string | null
          seat_count?: number | null
          slug?: string
          staff_breakdown?: Json | null
          staff_count?: number | null
          status?: string | null
          updated_at?: string | null
          view_count?: number | null
          website_url?: string | null
        }
        Relationships: []
      }
      facility_qa: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          created_at: string | null
          facility_id: string
          id: string
          is_public: boolean | null
          question: string
          status: string | null
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string | null
          facility_id: string
          id?: string
          is_public?: boolean | null
          question: string
          status?: string | null
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string | null
          facility_id?: string
          id?: string
          is_public?: boolean | null
          question?: string
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_qa_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_qa_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_reviews: {
        Row: {
          booking_id: string | null
          comment: string | null
          created_at: string | null
          facility_id: string
          flag_reason: string | null
          id: string
          is_flagged: boolean | null
          is_verified_visit: boolean | null
          photo_urls: string[] | null
          rating: number
          rating_atmosphere: number | null
          rating_cleanliness: number | null
          rating_explanation: number | null
          rating_service: number | null
          rating_skill: number | null
          replied_at: string | null
          reply: string | null
          reviewer_ip: string | null
          reviewer_name: string
          staff_id: string | null
          status: string | null
          visit_date: string | null
        }
        Insert: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string | null
          facility_id: string
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean | null
          is_verified_visit?: boolean | null
          photo_urls?: string[] | null
          rating: number
          rating_atmosphere?: number | null
          rating_cleanliness?: number | null
          rating_explanation?: number | null
          rating_service?: number | null
          rating_skill?: number | null
          replied_at?: string | null
          reply?: string | null
          reviewer_ip?: string | null
          reviewer_name: string
          staff_id?: string | null
          status?: string | null
          visit_date?: string | null
        }
        Update: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string | null
          facility_id?: string
          flag_reason?: string | null
          id?: string
          is_flagged?: boolean | null
          is_verified_visit?: boolean | null
          photo_urls?: string[] | null
          rating?: number
          rating_atmosphere?: number | null
          rating_cleanliness?: number | null
          rating_explanation?: number | null
          rating_service?: number | null
          rating_skill?: number | null
          replied_at?: string | null
          reply?: string | null
          reviewer_ip?: string | null
          reviewer_name?: string
          staff_id?: string | null
          status?: string | null
          visit_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_reviews_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_reviews_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_reviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_symptoms: {
        Row: {
          description: string | null
          facility_id: string
          id: string
          symptom_id: string
        }
        Insert: {
          description?: string | null
          facility_id: string
          id?: string
          symptom_id: string
        }
        Update: {
          description?: string | null
          facility_id?: string
          id?: string
          symptom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_symptoms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_symptoms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_symptoms_symptom_id_fkey"
            columns: ["symptom_id"]
            isOneToOne: false
            referencedRelation: "symptoms"
            referencedColumns: ["id"]
          },
        ]
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
          facility_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          facility_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_articles: {
        Row: {
          created_at: string | null
          href: string
          id: string
          image_url: string | null
          is_active: boolean | null
          sort_order: number | null
          subtitle: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          href: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          subtitle?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          href?: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          sort_order?: number | null
          subtitle?: string | null
          title?: string
        }
        Relationships: []
      }
      features: {
        Row: {
          banner_image_url: string | null
          content: Json | null
          created_at: string | null
          description: string | null
          display_order: number | null
          expires_at: string | null
          filter_keyword: string | null
          filter_prefecture: string | null
          filter_type: string | null
          id: string
          is_published: boolean | null
          published_at: string | null
          slug: string
          title: string
          updated_at: string | null
        }
        Insert: {
          banner_image_url?: string | null
          content?: Json | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          expires_at?: string | null
          filter_keyword?: string | null
          filter_prefecture?: string | null
          filter_type?: string | null
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          slug: string
          title: string
          updated_at?: string | null
        }
        Update: {
          banner_image_url?: string | null
          content?: Json | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          expires_at?: string | null
          filter_keyword?: string | null
          filter_prefecture?: string | null
          filter_type?: string | null
          id?: string
          is_published?: boolean | null
          published_at?: string | null
          slug?: string
          title?: string
          updated_at?: string | null
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
      line_notification_logs: {
        Row: {
          booking_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          line_user_id: string
          notification_type: string
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          line_user_id: string
          notification_type: string
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          line_user_id?: string
          notification_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_notification_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      line_user_links: {
        Row: {
          display_name: string | null
          id: string
          line_user_id: string
          linked_at: string | null
          picture_url: string | null
          user_id: string | null
        }
        Insert: {
          display_name?: string | null
          id?: string
          line_user_id: string
          linked_at?: string | null
          picture_url?: string | null
          user_id?: string | null
        }
        Update: {
          display_name?: string | null
          id?: string
          line_user_id?: string
          linked_at?: string | null
          picture_url?: string | null
          user_id?: string | null
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
          menu_id: string
          staff_id: string
        }
        Update: {
          id?: string
          menu_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_staff_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          id: string
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
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
      referral_codes: {
        Row: {
          code: string
          created_at: string | null
          id: string
          used_count: number | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          used_count?: number | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          used_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      referral_uses: {
        Row: {
          code: string
          created_at: string | null
          id: string
          points_awarded: boolean | null
          referred_user_id: string
          referrer_user_id: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          points_awarded?: boolean | null
          referred_user_id: string
          referrer_user_id: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          points_awarded?: boolean | null
          referred_user_id?: string
          referrer_user_id?: string
        }
        Relationships: []
      }
      review_helpful: {
        Row: {
          created_at: string | null
          id: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_helpful_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "facility_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_helpful_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "public_reviews"
            referencedColumns: ["id"]
          },
        ]
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
          review_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "facility_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_replies_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "public_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      salons: {
        Row: {
          address: string | null
          building_name: string | null
          business_hours: string | null
          business_type: string
          contact_name: string
          contact_phone: string | null
          created_at: string | null
          desired_start_date: string | null
          email: string
          facility_name: string
          features: string[] | null
          has_parking: boolean | null
          id: string
          is_public: boolean | null
          nearest_station: string | null
          phone: string
          photo_url: string | null
          photo_urls: string[] | null
          postal_code: string | null
          pr_text: string | null
          regular_holiday: string | null
          representative_name: string
          seat_count: number | null
          staff_count: number | null
          status: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          building_name?: string | null
          business_hours?: string | null
          business_type: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string | null
          desired_start_date?: string | null
          email: string
          facility_name: string
          features?: string[] | null
          has_parking?: boolean | null
          id?: string
          is_public?: boolean | null
          nearest_station?: string | null
          phone: string
          photo_url?: string | null
          photo_urls?: string[] | null
          postal_code?: string | null
          pr_text?: string | null
          regular_holiday?: string | null
          representative_name: string
          seat_count?: number | null
          staff_count?: number | null
          status?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          building_name?: string | null
          business_hours?: string | null
          business_type?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string | null
          desired_start_date?: string | null
          email?: string
          facility_name?: string
          features?: string[] | null
          has_parking?: boolean | null
          id?: string
          is_public?: boolean | null
          nearest_station?: string | null
          phone?: string
          photo_url?: string | null
          photo_urls?: string[] | null
          postal_code?: string | null
          pr_text?: string | null
          regular_holiday?: string | null
          representative_name?: string
          seat_count?: number | null
          staff_count?: number | null
          status?: string | null
          website?: string | null
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
          staff_id: string
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
        Relationships: [
          {
            foreignKeyName: "schedule_overrides_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_incident_threads: {
        Row: {
          channel: string
          created_at: string
          event_count: number
          expires_at: string
          thread_key: string
          thread_ts: string
        }
        Insert: {
          channel: string
          created_at?: string
          event_count?: number
          expires_at?: string
          thread_key: string
          thread_ts: string
        }
        Update: {
          channel?: string
          created_at?: string
          event_count?: number
          expires_at?: string
          thread_key?: string
          thread_ts?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
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
          staff_id: string
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
        Relationships: [
          {
            foreignKeyName: "staff_photos_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          bio: string | null
          certifications: string[] | null
          created_at: string | null
          facility_id: string
          id: string
          instagram_url: string | null
          is_active: boolean | null
          line_works_channel_id: string | null
          line_works_notify_all: boolean
          name: string
          nomination_fee: number | null
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
          certifications?: string[] | null
          created_at?: string | null
          facility_id: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          line_works_channel_id?: string | null
          line_works_notify_all?: boolean
          name: string
          nomination_fee?: number | null
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
          certifications?: string[] | null
          created_at?: string | null
          facility_id?: string
          id?: string
          instagram_url?: string | null
          is_active?: boolean | null
          line_works_channel_id?: string | null
          line_works_notify_all?: boolean
          name?: string
          nomination_fee?: number | null
          photo_url?: string | null
          position?: string | null
          slug?: string
          sort_order?: number | null
          specialties?: string[] | null
          updated_at?: string | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
          staff_id: string
          start_time: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          staff_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          processed_at: string
          type: string | null
        }
        Insert: {
          id: string
          processed_at?: string
          type?: string | null
        }
        Update: {
          id?: string
          processed_at?: string
          type?: string | null
        }
        Relationships: []
      }
      symptoms: {
        Row: {
          category: string
          id: string
          name: string
          slug: string
          sort_order: number | null
        }
        Insert: {
          category: string
          id?: string
          name: string
          slug: string
          sort_order?: number | null
        }
        Update: {
          category?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number | null
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
          facility_id: string
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
        Relationships: [
          {
            foreignKeyName: "treatment_catalogs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_catalogs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_catalogs_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_catalogs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "user_points_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      facility_card_view: {
        Row: {
          access_info: string | null
          business_hours: Json | null
          business_type: string | null
          catch_copy: string | null
          city: string | null
          coupon_count: number | null
          created_at: string | null
          description: string | null
          features: string[] | null
          google_rating: number | null
          google_review_count: number | null
          id: string | null
          latitude: number | null
          longitude: number | null
          main_photo_url: string | null
          max_price: number | null
          menu_count: number | null
          min_price: number | null
          name: string | null
          photo_count: number | null
          prefecture: string | null
          rating_avg: number | null
          rating_count: number | null
          seat_count: number | null
          slug: string | null
          status: string | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      public_reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          facility_id: string | null
          id: string | null
          is_verified_visit: boolean | null
          photo_urls: string[] | null
          rating: number | null
          rating_atmosphere: number | null
          rating_cleanliness: number | null
          rating_explanation: number | null
          rating_service: number | null
          rating_skill: number | null
          reviewer_name: string | null
          status: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          facility_id?: string | null
          id?: string | null
          is_verified_visit?: boolean | null
          photo_urls?: string[] | null
          rating?: number | null
          rating_atmosphere?: number | null
          rating_cleanliness?: number | null
          rating_explanation?: number | null
          rating_service?: number | null
          rating_skill?: number | null
          reviewer_name?: string | null
          status?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          facility_id?: string | null
          id?: string | null
          is_verified_visit?: boolean | null
          photo_urls?: string[] | null
          rating?: number | null
          rating_atmosphere?: number | null
          rating_cleanliness?: number | null
          rating_explanation?: number | null
          rating_service?: number | null
          rating_skill?: number | null
          reviewer_name?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_reviews_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_reviews_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number }
        Returns: boolean
      }
      create_admin_booking_atomic: {
        Args: {
          p_booking_date: string
          p_customer_name: string
          p_email: string
          p_end_time: string
          p_facility_id: string
          p_menu_id: string
          p_note: string
          p_phone: string
          p_source: string
          p_staff_id: string
          p_start_time: string
          p_total_price: number
        }
        Returns: string
      }
      create_booking_atomic: {
        Args: {
          p_booking_date: string
          p_coupon_id: string
          p_customer_name: string
          p_email: string
          p_end_time: string
          p_facility_id: string
          p_menu_id: string
          p_note: string
          p_phone: string
          p_points_used?: number
          p_staff_id: string
          p_start_time: string
          p_status?: string
          p_total_price: number
          p_user_id: string
        }
        Returns: string
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      find_bulk_review_ips: {
        Args: { p_since: string; p_threshold: number }
        Returns: {
          reviewer_ip: string
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_available_slots: {
        Args: {
          p_date: string
          p_duration_minutes: number
          p_facility_id: string
          p_staff_id: string
        }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      get_incident_thread: {
        Args: { p_key: string }
        Returns: {
          channel: string
          thread_ts: string
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      increment_view_count: {
        Args: { facility_uuid: string }
        Returns: undefined
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      record_incident_thread: {
        Args: { p_channel: string; p_key: string; p_thread_ts: string }
        Returns: undefined
      }
      search_facilities_nearby: {
        Args: {
          limit_count?: number
          radius_km?: number
          type_filter?: string
          user_lat: number
          user_lng: number
        }
        Returns: {
          access_info: string
          business_hours: Json
          business_type: string
          catch_copy: string
          city: string
          coupon_count: number
          distance_km: number
          google_rating: number
          google_review_count: number
          id: string
          latitude: number
          longitude: number
          main_photo_url: string
          max_price: number
          menu_count: number
          min_price: number
          name: string
          photo_count: number
          prefecture: string
          rating_avg: number
          rating_count: number
          seat_count: number
          slug: string
        }[]
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_admin_booking_atomic: {
        Args: {
          p_booking_date: string
          p_booking_id: string
          p_customer_name: string
          p_email: string
          p_end_time: string
          p_facility_id: string
          p_menu_id: string
          p_note: string
          p_phone: string
          p_staff_id: string
          p_start_time: string
          p_total_price: number
        }
        Returns: string
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
