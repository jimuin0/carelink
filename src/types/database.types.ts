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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ab_test_events: {
        Row: {
          created_at: string
          event_type: string
          experiment_key: string
          id: string
          metadata: Json | null
          page_path: string | null
          session_id: string | null
          user_id: string | null
          variant: string
        }
        Insert: {
          created_at?: string
          event_type: string
          experiment_key: string
          id?: string
          metadata?: Json | null
          page_path?: string | null
          session_id?: string | null
          user_id?: string | null
          variant: string
        }
        Update: {
          created_at?: string
          event_type?: string
          experiment_key?: string
          id?: string
          metadata?: Json | null
          page_path?: string | null
          session_id?: string | null
          user_id?: string | null
          variant?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          facility_id: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      audit_logs: {
        Row: {
          action: string
          created_at: string
          facility_id: string | null
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      birthday_notifications: {
        Row: {
          user_id: string
          year: number
          notified_at: string
          channel: string
        }
        Insert: {
          user_id: string
          year: number
          notified_at?: string
          channel: string
        }
        Update: {
          user_id?: string
          year?: number
          notified_at?: string
          channel?: string
        }
        Relationships: [
          {
            foreignKeyName: "birthday_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          image_urls: string[]
          is_published: boolean | null
          published_at: string | null
          scheduled_at: string | null
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
          image_urls?: string[]
          is_published?: boolean | null
          published_at?: string | null
          scheduled_at?: string | null
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
          image_urls?: string[]
          is_published?: boolean | null
          published_at?: string | null
          scheduled_at?: string | null
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
      booking_calendar_events: {
        Row: {
          booking_id: string
          calendar_id: string
          google_event_id: string
          id: string
          synced_at: string
          user_id: string
        }
        Insert: {
          booking_id: string
          calendar_id?: string
          google_event_id: string
          id?: string
          synced_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          calendar_id?: string
          google_event_id?: string
          id?: string
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_calendar_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
      booking_waitlist: {
        Row: {
          created_at: string
          customer_name: string
          date: string
          email: string | null
          end_time: string
          expires_at: string | null
          facility_id: string
          id: string
          line_user_id: string | null
          menu_id: string | null
          notes: string | null
          notified_at: string | null
          phone: string | null
          staff_id: string | null
          start_time: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_name: string
          date: string
          email?: string | null
          end_time: string
          expires_at?: string | null
          facility_id: string
          id?: string
          line_user_id?: string | null
          menu_id?: string | null
          notes?: string | null
          notified_at?: string | null
          phone?: string | null
          staff_id?: string | null
          start_time: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string
          date?: string
          email?: string | null
          end_time?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          line_user_id?: string | null
          menu_id?: string | null
          notes?: string | null
          notified_at?: string | null
          phone?: string | null
          staff_id?: string | null
          start_time?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_waitlist_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_waitlist_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_waitlist_menu_id_fkey"
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
          email_canonical: string | null
          end_time: string
          facility_id: string
          id: string
          menu_id: string | null
          menu_ids: string[] | null
          note: string | null
          paid_amount: number | null
          payjp_charge_id: string | null
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
          email_canonical?: string | null
          end_time: string
          facility_id: string
          id?: string
          menu_id?: string | null
          menu_ids?: string[] | null
          note?: string | null
          paid_amount?: number | null
          payjp_charge_id?: string | null
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
          email_canonical?: string | null
          end_time?: string
          facility_id?: string
          id?: string
          menu_id?: string | null
          menu_ids?: string[] | null
          note?: string | null
          paid_amount?: number | null
          payjp_charge_id?: string | null
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
      community_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string | null
          reply_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id?: string | null
          reply_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string | null
          reply_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_likes_reply_id_fkey"
            columns: ["reply_id"]
            isOneToOne: false
            referencedRelation: "community_replies"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_id: string
          body: string
          category: string
          created_at: string
          id: string
          is_locked: boolean
          is_pinned: boolean
          last_reply_at: string | null
          like_count: number
          reply_count: number
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id: string
          body: string
          category?: string
          created_at?: string
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          last_reply_at?: string | null
          like_count?: number
          reply_count?: number
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string
          body?: string
          category?: string
          created_at?: string
          id?: string
          is_locked?: boolean
          is_pinned?: boolean
          last_reply_at?: string | null
          like_count?: number
          reply_count?: number
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      community_replies: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_solution: boolean
          like_count: number
          post_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_solution?: boolean
          like_count?: number
          post_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_solution?: boolean
          like_count?: number
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_replies: {
        Row: {
          author_id: string | null
          author_name: string
          body: string
          contact_id: string
          created_at: string
          id: string
          is_internal: boolean
          sent_at: string | null
        }
        Insert: {
          author_id?: string | null
          author_name?: string
          body: string
          contact_id: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sent_at?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string
          body?: string
          contact_id?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_replies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          email: string
          id: string
          inquiry_type: string
          message: string
          name: string
          phone: string | null
          priority: string
          resolved_at: string | null
          ticket_notes: string | null
          ticket_status: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          email: string
          id?: string
          inquiry_type: string
          message: string
          name: string
          phone?: string | null
          priority?: string
          resolved_at?: string | null
          ticket_notes?: string | null
          ticket_status?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          email?: string
          id?: string
          inquiry_type?: string
          message?: string
          name?: string
          phone?: string | null
          priority?: string
          resolved_at?: string | null
          ticket_notes?: string | null
          ticket_status?: string
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
          image_submission: boolean
          image_url: string | null
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
          image_submission?: boolean
          image_url?: string | null
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
          image_submission?: boolean
          image_url?: string | null
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
      cron_logs: {
        Row: {
          duration_ms: number | null
          error_msg: string | null
          id: string
          job_name: string
          meta: Json | null
          processed: number | null
          skipped: number | null
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_msg?: string | null
          id?: string
          job_name: string
          meta?: Json | null
          processed?: number | null
          skipped?: number | null
          started_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error_msg?: string | null
          id?: string
          job_name?: string
          meta?: Json | null
          processed?: number | null
          skipped?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
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
          email_canonical: string | null
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
          email_canonical?: string | null
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
          email_canonical?: string | null
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
      email_unsubscribe_tokens: {
        Row: {
          created_at: string | null
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribe_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      facility_booking_suspensions: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          facility_id: string
          id: string
          start_time: string
          suspend_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          facility_id: string
          id?: string
          start_time: string
          suspend_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          facility_id?: string
          id?: string
          start_time?: string
          suspend_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_booking_suspensions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_booking_suspensions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      facility_daily_capacity: {
        Row: {
          capacity_date: string
          created_by: string | null
          facility_id: string
          id: string
          max_bookings: number
          updated_at: string
        }
        Insert: {
          capacity_date: string
          created_by?: string | null
          facility_id: string
          id?: string
          max_bookings: number
          updated_at?: string
        }
        Update: {
          capacity_date?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          max_bookings?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_daily_capacity_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_daily_capacity_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_entitlements: {
        Row: {
          created_at: string
          current_period_end: string | null
          facility_id: string
          id: string
          option_key: string
          status: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          facility_id: string
          id?: string
          option_key: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          facility_id?: string
          id?: string
          option_key?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_entitlements_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_entitlements_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_entitlements_option_key_fkey"
            columns: ["option_key"]
            isOneToOne: false
            referencedRelation: "option_catalog"
            referencedColumns: ["key"]
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
          flag_reason: string | null
          flagged_at: string | null
          genre: string | null
          id: string
          image_submission: boolean | null
          is_flagged: boolean
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
          flag_reason?: string | null
          flagged_at?: string | null
          genre?: string | null
          id?: string
          image_submission?: boolean | null
          is_flagged?: boolean
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
          flag_reason?: string | null
          flagged_at?: string | null
          genre?: string | null
          id?: string
          image_submission?: boolean | null
          is_flagged?: boolean
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
          address: string | null
          building: string | null
          business_hours: Json | null
          business_hours_text: string | null
          business_type: string
          catch_copy: string | null
          city: string | null
          created_at: string | null
          credit_card: boolean | null
          deposit_amount: number | null
          deposit_type: string | null
          description: string | null
          design_color: string | null
          design_template: string | null
          directions: string | null
          equipment: Json | null
          features: string[] | null
          gbp_cid: string | null
          gbp_connected_at: string | null
          gbp_place_id: string | null
          gbp_synced_at: string | null
          genres: string[] | null
          google_rating: number | null
          google_review_count: number | null
          header_photo_url: string | null
          hpb_sln_id: string | null
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
          prefecture: string | null
          rating_avg: number | null
          rating_count: number | null
          regular_holiday: string | null
          remarks: string | null
          seat_count: number | null
          slug: string
          staff_breakdown: Json | null
          staff_count: number | null
          status: string | null
          stripe_account_id: string | null
          stripe_enabled: boolean
          updated_at: string | null
          view_count: number | null
          website_url: string | null
        }
        Insert: {
          access_info?: string | null
          address?: string | null
          building?: string | null
          business_hours?: Json | null
          business_hours_text?: string | null
          business_type: string
          catch_copy?: string | null
          city?: string | null
          created_at?: string | null
          credit_card?: boolean | null
          deposit_amount?: number | null
          deposit_type?: string | null
          description?: string | null
          design_color?: string | null
          design_template?: string | null
          directions?: string | null
          equipment?: Json | null
          features?: string[] | null
          gbp_cid?: string | null
          gbp_connected_at?: string | null
          gbp_place_id?: string | null
          gbp_synced_at?: string | null
          genres?: string[] | null
          google_rating?: number | null
          google_review_count?: number | null
          header_photo_url?: string | null
          hpb_sln_id?: string | null
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
          prefecture?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          remarks?: string | null
          seat_count?: number | null
          slug: string
          staff_breakdown?: Json | null
          staff_count?: number | null
          status?: string | null
          stripe_account_id?: string | null
          stripe_enabled?: boolean
          updated_at?: string | null
          view_count?: number | null
          website_url?: string | null
        }
        Update: {
          access_info?: string | null
          address?: string | null
          building?: string | null
          business_hours?: Json | null
          business_hours_text?: string | null
          business_type?: string
          catch_copy?: string | null
          city?: string | null
          created_at?: string | null
          credit_card?: boolean | null
          deposit_amount?: number | null
          deposit_type?: string | null
          description?: string | null
          design_color?: string | null
          design_template?: string | null
          directions?: string | null
          equipment?: Json | null
          features?: string[] | null
          gbp_cid?: string | null
          gbp_connected_at?: string | null
          gbp_place_id?: string | null
          gbp_synced_at?: string | null
          genres?: string[] | null
          google_rating?: number | null
          google_review_count?: number | null
          header_photo_url?: string | null
          hpb_sln_id?: string | null
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
          prefecture?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          regular_holiday?: string | null
          remarks?: string | null
          seat_count?: number | null
          slug?: string
          staff_breakdown?: Json | null
          staff_count?: number | null
          status?: string | null
          stripe_account_id?: string | null
          stripe_enabled?: boolean
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
      facility_reminder_settings: {
        Row: {
          facility_id: string
          remind_3d_email: boolean
          remind_3d_line: boolean
          remind_7d_email: boolean
          remind_7d_line: boolean
          updated_at: string
        }
        Insert: {
          facility_id: string
          remind_3d_email?: boolean
          remind_3d_line?: boolean
          remind_7d_email?: boolean
          remind_7d_line?: boolean
          updated_at?: string
        }
        Update: {
          facility_id?: string
          remind_3d_email?: boolean
          remind_3d_line?: boolean
          remind_7d_email?: boolean
          remind_7d_line?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_reminder_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_reminder_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
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
          is_pickup: boolean
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
          is_pickup?: boolean
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
          is_pickup?: boolean
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
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          metadata: Json | null
          rollout_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          metadata?: Json | null
          rollout_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          metadata?: Json | null
          rollout_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      featured_slots: {
        Row: {
          area: string | null
          budget_yen: number
          business_type: string | null
          clicks: number
          created_at: string
          ends_at: string
          facility_id: string
          id: string
          impressions: number
          is_active: boolean
          slot_type: string
          starts_at: string
          stripe_session_id: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          budget_yen?: number
          business_type?: string | null
          clicks?: number
          created_at?: string
          ends_at: string
          facility_id: string
          id?: string
          impressions?: number
          is_active?: boolean
          slot_type: string
          starts_at: string
          stripe_session_id?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          budget_yen?: number
          business_type?: string | null
          clicks?: number
          created_at?: string
          ends_at?: string
          facility_id?: string
          id?: string
          impressions?: number
          is_active?: boolean
          slot_type?: string
          starts_at?: string
          stripe_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "featured_slots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "featured_slots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      gbp_audit_cache: {
        Row: {
          details: Json | null
          facility_id: string
          fetched_at: string | null
          id: string
          score: number | null
        }
        Insert: {
          details?: Json | null
          facility_id: string
          fetched_at?: string | null
          id?: string
          score?: number | null
        }
        Update: {
          details?: Json | null
          facility_id?: string
          fetched_at?: string | null
          id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gbp_audit_cache_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gbp_audit_cache_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: true
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gbp_posts: {
        Row: {
          body: string
          created_at: string | null
          cta_type: string | null
          cta_url: string | null
          facility_id: string
          gbp_post_id: string | null
          id: string
          photo_url: string | null
          post_type: string | null
          published_at: string | null
          scheduled_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          cta_type?: string | null
          cta_url?: string | null
          facility_id: string
          gbp_post_id?: string | null
          id?: string
          photo_url?: string | null
          post_type?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          cta_type?: string | null
          cta_url?: string | null
          facility_id?: string
          gbp_post_id?: string | null
          id?: string
          photo_url?: string | null
          post_type?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gbp_posts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gbp_posts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      group_booking_members: {
        Row: {
          created_at: string
          group_booking_id: string
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          is_organizer: boolean
          joined_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          group_booking_id: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          is_organizer?: boolean
          joined_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          group_booking_id?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          is_organizer?: boolean
          joined_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_booking_members_group_booking_id_fkey"
            columns: ["group_booking_id"]
            isOneToOne: false
            referencedRelation: "group_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      group_bookings: {
        Row: {
          booking_date: string
          confirmed_members: number
          created_at: string
          end_time: string
          facility_id: string
          id: string
          menu_id: string | null
          notes: string | null
          organizer_id: string | null
          share_code: string | null
          staff_id: string | null
          start_time: string
          status: string
          total_members: number
          updated_at: string
        }
        Insert: {
          booking_date: string
          confirmed_members?: number
          created_at?: string
          end_time: string
          facility_id: string
          id?: string
          menu_id?: string | null
          notes?: string | null
          organizer_id?: string | null
          share_code?: string | null
          staff_id?: string | null
          start_time: string
          status?: string
          total_members?: number
          updated_at?: string
        }
        Update: {
          booking_date?: string
          confirmed_members?: number
          created_at?: string
          end_time?: string
          facility_id?: string
          id?: string
          menu_id?: string | null
          notes?: string | null
          organizer_id?: string | null
          share_code?: string | null
          staff_id?: string | null
          start_time?: string
          status?: string
          total_members?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_bookings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_bookings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_bookings_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_bookings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hpb_menu_durations: {
        Row: {
          created_at: string
          description: string | null
          description_override: string | null
          duration_min: number | null
          duration_min_override: number | null
          facility_id: string
          is_hidden: boolean
          kind: string
          name: string
          name_override: string | null
          price: number | null
          price_override: number | null
          ref_id: string
          store_id: string
          target: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_override?: string | null
          duration_min?: number | null
          duration_min_override?: number | null
          facility_id: string
          is_hidden?: boolean
          kind?: string
          name: string
          name_override?: string | null
          price?: number | null
          price_override?: number | null
          ref_id: string
          store_id: string
          target?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          description_override?: string | null
          duration_min?: number | null
          duration_min_override?: number | null
          facility_id?: string
          is_hidden?: boolean
          kind?: string
          name?: string
          name_override?: string | null
          price?: number | null
          price_override?: number | null
          ref_id?: string
          store_id?: string
          target?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hpb_menu_durations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_form_responses: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_name: string
          facility_id: string
          id: string
          responses: Json
          submitted_at: string
          template_id: string
          user_id: string | null
          viewed_at: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_name: string
          facility_id: string
          id?: string
          responses?: Json
          submitted_at?: string
          template_id: string
          user_id?: string | null
          viewed_at?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_name?: string
          facility_id?: string
          id?: string
          responses?: Json
          submitted_at?: string
          template_id?: string
          user_id?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_form_responses_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_form_responses_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_form_responses_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_form_responses_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "intake_form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_form_templates: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          fields: Json
          id: string
          is_active: boolean
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          fields?: Json
          id?: string
          is_active?: boolean
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          fields?: Json
          id?: string
          is_active?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_form_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_form_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          applicant_email: string
          applicant_name: string
          applicant_phone: string | null
          applicant_user_id: string | null
          cover_letter: string | null
          created_at: string
          facility_id: string
          fee_invoiced_at: string | null
          fee_paid_at: string | null
          hired_at: string | null
          id: string
          job_posting_id: string | null
          notes: string | null
          referral_fee_yen: number | null
          resume_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applicant_email: string
          applicant_name: string
          applicant_phone?: string | null
          applicant_user_id?: string | null
          cover_letter?: string | null
          created_at?: string
          facility_id: string
          fee_invoiced_at?: string | null
          fee_paid_at?: string | null
          hired_at?: string | null
          id?: string
          job_posting_id?: string | null
          notes?: string | null
          referral_fee_yen?: number | null
          resume_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applicant_email?: string
          applicant_name?: string
          applicant_phone?: string | null
          applicant_user_id?: string | null
          cover_letter?: string | null
          created_at?: string
          facility_id?: string
          fee_invoiced_at?: string | null
          fee_paid_at?: string | null
          hired_at?: string | null
          id?: string
          job_posting_id?: string | null
          notes?: string | null
          referral_fee_yen?: number | null
          resume_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
        ]
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
      moderation_queue: {
        Row: {
          auto_flags: Json | null
          content_id: string
          content_type: string
          created_at: string
          facility_id: string | null
          id: string
          report_reason: string | null
          reporter_id: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          auto_flags?: Json | null
          content_id: string
          content_type: string
          created_at?: string
          facility_id?: string | null
          id?: string
          report_reason?: string | null
          reporter_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          auto_flags?: Json | null
          content_id?: string
          content_type?: string
          created_at?: string
          facility_id?: string | null
          id?: string
          report_reason?: string | null
          reporter_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_campaigns: {
        Row: {
          campaign_type: string
          created_at: string
          created_by: string | null
          html_content: string
          id: string
          scheduled_at: string | null
          sent_at: string | null
          stats: Json | null
          status: string
          subject: string
          target_segment: Json | null
          text_content: string | null
          updated_at: string
        }
        Insert: {
          campaign_type: string
          created_at?: string
          created_by?: string | null
          html_content: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          stats?: Json | null
          status?: string
          subject: string
          target_segment?: Json | null
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          campaign_type?: string
          created_at?: string
          created_by?: string | null
          html_content?: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          stats?: Json | null
          status?: string
          subject?: string
          target_segment?: Json | null
          text_content?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      newsletter_send_log: {
        Row: {
          campaign_id: string | null
          email: string
          period: string
          sent_at: string
        }
        Insert: {
          campaign_id?: string | null
          email: string
          period: string
          sent_at?: string
        }
        Update: {
          campaign_id?: string | null
          email?: string
          period?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_send_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscriptions: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          source: string | null
          subscription_type: string
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          source?: string | null
          subscription_type: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          source?: string | null
          subscription_type?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      nps_surveys: {
        Row: {
          booking_id: string | null
          category: string | null
          comment: string | null
          created_at: string
          facility_id: string | null
          id: string
          ip_hash: string | null
          score: number
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          category?: string | null
          comment?: string | null
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_hash?: string | null
          score: number
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          category?: string | null
          comment?: string | null
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_hash?: string | null
          score?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nps_surveys_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nps_surveys_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nps_surveys_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      option_catalog: {
        Row: {
          contact_only: boolean
          created_at: string
          description: string | null
          is_active: boolean
          key: string
          monthly_price: number
          name: string
          sort_order: number
        }
        Insert: {
          contact_only?: boolean
          created_at?: string
          description?: string | null
          is_active?: boolean
          key: string
          monthly_price?: number
          name: string
          sort_order?: number
        }
        Update: {
          contact_only?: boolean
          created_at?: string
          description?: string | null
          is_active?: boolean
          key?: string
          monthly_price?: number
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      package_usage_logs: {
        Row: {
          booking_id: string | null
          id: string
          notes: string | null
          used_at: string
          user_package_id: string
        }
        Insert: {
          booking_id?: string | null
          id?: string
          notes?: string | null
          used_at?: string
          user_package_id: string
        }
        Update: {
          booking_id?: string | null
          id?: string
          notes?: string | null
          used_at?: string
          user_package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_usage_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_usage_logs_user_package_id_fkey"
            columns: ["user_package_id"]
            isOneToOne: false
            referencedRelation: "user_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_blog_posts: {
        Row: {
          author_name: string
          category: string
          content: Json
          created_at: string
          description: string
          id: string
          is_published: boolean
          published_at: string | null
          reading_time: number
          slug: string
          tags: string[]
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string
          category?: string
          content?: Json
          created_at?: string
          description?: string
          id?: string
          is_published?: boolean
          published_at?: string | null
          reading_time?: number
          slug: string
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string
          category?: string
          content?: Json
          created_at?: string
          description?: string
          id?: string
          is_published?: boolean
          published_at?: string | null
          reading_time?: number
          slug?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
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
          email_unsubscribed: boolean | null
          gender: string | null
          id: string
          is_platform_admin: boolean
          phone: string | null
          prefecture: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          email_unsubscribed?: boolean | null
          gender?: string | null
          id: string
          is_platform_admin?: boolean
          phone?: string | null
          prefecture?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          email_unsubscribed?: boolean | null
          gender?: string | null
          id?: string
          is_platform_admin?: boolean
          phone?: string | null
          prefecture?: string | null
          role?: string | null
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
      reports: {
        Row: {
          created_at: string | null
          detail: string | null
          id: string
          reason: string
          reporter_ip: string | null
          reporter_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string | null
          detail?: string | null
          id?: string
          reason: string
          reporter_ip?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string | null
          detail?: string | null
          id?: string
          reason?: string
          reporter_ip?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      salon_customer_notes: {
        Row: {
          customer_key: string
          facility_id: string
          id: string
          next_visit_date: string | null
          next_visit_note: string | null
          note: string | null
          tags: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          customer_key: string
          facility_id: string
          id?: string
          next_visit_date?: string | null
          next_visit_note?: string | null
          note?: string | null
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          customer_key?: string
          facility_id?: string
          id?: string
          next_visit_date?: string | null
          next_visit_note?: string | null
          note?: string | null
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_customer_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_customer_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
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
      sent_reminders: {
        Row: {
          booking_id: string
          id: string
          kind: string
          reminder_date: string
          sent_at: string
        }
        Insert: {
          booking_id: string
          id?: string
          kind?: string
          reminder_date: string
          sent_at?: string
        }
        Update: {
          booking_id?: string
          id?: string
          kind?: string
          reminder_date?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      service_packages: {
        Row: {
          bonus_count: number
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          menu_id: string | null
          name: string
          notes: string | null
          price: number
          session_count: number
          sort_order: number
          updated_at: string
          valid_days: number
        }
        Insert: {
          bonus_count?: number
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          menu_id?: string | null
          name: string
          notes?: string | null
          price?: number
          session_count?: number
          sort_order?: number
          updated_at?: string
          valid_days?: number
        }
        Update: {
          bonus_count?: number
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          menu_id?: string | null
          name?: string
          notes?: string | null
          price?: number
          session_count?: number
          sort_order?: number
          updated_at?: string
          valid_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_packages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_packages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_packages_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "facility_menus"
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
      stripe_sessions: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          currency: string
          expires_at: string | null
          facility_id: string
          id: string
          metadata: Json | null
          payment_type: string
          refund_amount: number | null
          refunded_at: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          facility_id: string
          id?: string
          metadata?: Json | null
          payment_type?: string
          refund_amount?: number | null
          refunded_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          facility_id?: string
          id?: string
          metadata?: Json | null
          payment_type?: string
          refund_amount?: number | null
          refunded_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_logs: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          price: number
          sessions_per_month: number
          sort_order: number
          valid_months: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          price: number
          sessions_per_month?: number
          sort_order?: number
          valid_months?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          price?: number
          sessions_per_month?: number
          sort_order?: number
          valid_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_usage_logs: {
        Row: {
          booking_id: string | null
          id: string
          notes: string | null
          subscription_id: string
          used_at: string
        }
        Insert: {
          booking_id?: string | null
          id?: string
          notes?: string | null
          subscription_id: string
          used_at?: string
        }
        Update: {
          booking_id?: string | null
          id?: string
          notes?: string | null
          subscription_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_usage_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_usage_logs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
      telehealth_sessions: {
        Row: {
          booking_id: string | null
          created_at: string
          duration_minutes: number
          facility_id: string
          fee: number | null
          id: string
          meeting_url: string | null
          patient_notes: string | null
          platform: string | null
          room_id: string | null
          scheduled_at: string
          session_notes: string | null
          staff_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          duration_minutes?: number
          facility_id: string
          fee?: number | null
          id?: string
          meeting_url?: string | null
          patient_notes?: string | null
          platform?: string | null
          room_id?: string | null
          scheduled_at: string
          session_notes?: string | null
          staff_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          duration_minutes?: number
          facility_id?: string
          fee?: number | null
          id?: string
          meeting_url?: string | null
          patient_notes?: string | null
          platform?: string | null
          room_id?: string | null
          scheduled_at?: string
          session_notes?: string | null
          staff_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telehealth_sessions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telehealth_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telehealth_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telehealth_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      treatment_plans: {
        Row: {
          completed_sessions: number
          created_at: string
          diagnosis: string | null
          duration_weeks: number | null
          ended_at: string | null
          facility_id: string
          frequency: string | null
          goal: string | null
          id: string
          notes: string | null
          staff_id: string | null
          started_at: string | null
          status: string
          title: string
          total_sessions: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          completed_sessions?: number
          created_at?: string
          diagnosis?: string | null
          duration_weeks?: number | null
          ended_at?: string | null
          facility_id: string
          frequency?: string | null
          goal?: string | null
          id?: string
          notes?: string | null
          staff_id?: string | null
          started_at?: string | null
          status?: string
          title: string
          total_sessions?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          completed_sessions?: number
          created_at?: string
          diagnosis?: string | null
          duration_weeks?: number | null
          ended_at?: string | null
          facility_id?: string
          frequency?: string | null
          goal?: string | null
          id?: string
          notes?: string | null
          staff_id?: string | null
          started_at?: string | null
          status?: string
          title?: string
          total_sessions?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_records: {
        Row: {
          assessment: string | null
          booking_id: string | null
          created_at: string
          facility_id: string
          id: string
          menu_name: string | null
          next_visit_note: string | null
          notes: string | null
          objective: string | null
          plan: string | null
          staff_id: string | null
          subjective: string | null
          treated_at: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assessment?: string | null
          booking_id?: string | null
          created_at?: string
          facility_id: string
          id?: string
          menu_name?: string | null
          next_visit_note?: string | null
          notes?: string | null
          objective?: string | null
          plan?: string | null
          staff_id?: string | null
          subjective?: string | null
          treated_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assessment?: string | null
          booking_id?: string | null
          created_at?: string
          facility_id?: string
          id?: string
          menu_name?: string | null
          next_visit_note?: string | null
          notes?: string | null
          objective?: string | null
          plan?: string | null
          staff_id?: string | null
          subjective?: string | null
          treated_at?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treatment_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_coupon_codes: {
        Row: {
          code: string
          created_at: string | null
          discount_type: string
          discount_value: number
          email: string
          facility_id: string
          id: string
          notified_at: string | null
          reason: string | null
          used_at: string | null
          valid_until: string
        }
        Insert: {
          code: string
          created_at?: string | null
          discount_type?: string
          discount_value: number
          email: string
          facility_id: string
          id?: string
          notified_at?: string | null
          reason?: string | null
          used_at?: string | null
          valid_until: string
        }
        Update: {
          code?: string
          created_at?: string | null
          discount_type?: string
          discount_value?: number
          email?: string
          facility_id?: string
          id?: string
          notified_at?: string | null
          reason?: string | null
          used_at?: string | null
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_coupon_codes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_coupon_codes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_packages: {
        Row: {
          expires_at: string | null
          facility_id: string
          id: string
          notes: string | null
          package_id: string
          purchased_at: string
          sessions_remaining: number
          sessions_total: number
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          package_id: string
          purchased_at?: string
          sessions_remaining: number
          sessions_total: number
          user_id: string
        }
        Update: {
          expires_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          package_id?: string
          purchased_at?: string
          sessions_remaining?: number
          sessions_total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_packages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_packages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_packages_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
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
      user_preferred_staff: {
        Row: {
          created_at: string
          id: string
          staff_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          staff_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          staff_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferred_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          created_at: string
          ends_at: string | null
          facility_id: string
          id: string
          month_reset_at: string
          notes: string | null
          plan_id: string
          sessions_used_this_month: number
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          facility_id: string
          id?: string
          month_reset_at?: string
          notes?: string | null
          plan_id: string
          sessions_used_this_month?: number
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          facility_id?: string
          id?: string
          month_reset_at?: string
          notes?: string | null
          plan_id?: string
          sessions_used_this_month?: number
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_retry_queue: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          created_at: string
          delivered_at: string | null
          facility_id: string | null
          id: string
          last_error: string | null
          max_attempts: number
          payload: Json
          processed_at: string | null
          scheduled_at: string
          status: string
          target_id: string
          webhook_type: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload: Json
          processed_at?: string | null
          scheduled_at?: string
          status?: string
          target_id: string
          webhook_type: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          processed_at?: string | null
          scheduled_at?: string
          status?: string
          target_id?: string
          webhook_type?: string
        }
        Relationships: []
      }
      white_label_domains: {
        Row: {
          brand_name: string | null
          created_at: string
          domain: string
          facility_id: string
          id: string
          is_verified: boolean
          logo_url: string | null
          primary_color: string | null
          txt_record: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          brand_name?: string | null
          created_at?: string
          domain: string
          facility_id: string
          id?: string
          is_verified?: boolean
          logo_url?: string | null
          primary_color?: string | null
          txt_record?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          brand_name?: string | null
          created_at?: string
          domain?: string
          facility_id?: string
          id?: string
          is_verified?: boolean
          logo_url?: string | null
          primary_color?: string | null
          txt_record?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "white_label_domains_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_card_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "white_label_domains_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facility_profiles"
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
      booking_status_occupies: { Args: { p_status: string }; Returns: boolean }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number }
        Returns: boolean
      }
      cleanup_old_audit_logs: { Args: never; Returns: undefined }
      cleanup_old_cron_logs: { Args: never; Returns: undefined }
      cleanup_old_webhook_retry: { Args: never; Returns: undefined }
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
      create_blog_author_atomic: {
        Args: { p_facility_id: string; p_name: string }
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
      get_facility_customers: {
        Args: { p_facility_id: string }
        Returns: {
          customer_key: string
          email: string
          last_visit: string
          name: string
          phone: string
          visit_count: number
        }[]
      }
      get_incident_thread: {
        Args: { p_key: string }
        Returns: {
          channel: string
          thread_ts: string
        }[]
      }
      get_month_availability: {
        Args: {
          p_dates: string[]
          p_duration_minutes: number
          p_facility_id: string
          p_staff_ids: string[]
        }
        Returns: {
          d: string
          slots: number
        }[]
      }
      get_unique_customers: {
        Args: { p_facility_id: string }
        Returns: {
          email: string
          last_visit: string
          name: string
          visit_count: number
        }[]
      }
      get_user_points_balance: { Args: { p_user_id: string }; Returns: number }
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
      reorder_coupons: {
        Args: { p_facility_id: string; p_ids: string[] }
        Returns: undefined
      }
      reorder_facility_menus: {
        Args: { p_facility_id: string; p_ids: string[] }
        Returns: undefined
      }
      reorder_facility_photos: {
        Args: { p_facility_id: string; p_ids: string[] }
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
      set_review_pickup_atomic: {
        Args: { p_facility_id: string; p_review_id: string }
        Returns: undefined
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
