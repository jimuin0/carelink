import { createServerSupabaseClient } from './supabase-server';
import type { Booking } from '@/types';

export async function createBooking(data: Omit<Booking, 'id' | 'created_at' | 'updated_at' | 'status'>): Promise<{ booking: Booking | null; error: string | null }> {
  const supabase = createServerSupabaseClient();

  // 競合チェック
  if (data.staff_id) {
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('staff_id', data.staff_id)
      .eq('booking_date', data.booking_date)
      .not('status', 'in', '("cancelled","no_show")')
      .lt('start_time', data.end_time)
      .gt('end_time', data.start_time);

    if (conflicts && conflicts.length > 0) {
      return { booking: null, error: 'この時間帯は既に予約が入っています' };
    }
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({ ...data, status: 'pending' })
    .select()
    .single();

  return {
    booking: booking as Booking | null,
    error: error?.message ?? null,
  };
}

export async function getUserBookings(userId: string): Promise<Booking[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_id', userId)
    .order('booking_date', { ascending: false });
  return (data ?? []) as Booking[];
}

export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();
  return data as Booking | null;
}

export async function cancelBooking(bookingId: string, userId: string): Promise<{ error: string | null }> {
  const supabase = createServerSupabaseClient();

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status')
    .eq('id', bookingId)
    .single();

  if (!booking) return { error: '予約が見つかりません' };
  if (booking.user_id !== userId) return { error: '権限がありません' };
  if (booking.status === 'cancelled') return { error: '既にキャンセル済みです' };
  if (booking.status === 'completed') return { error: '完了済みの予約はキャンセルできません' };

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', bookingId);

  return { error: error?.message ?? null };
}
