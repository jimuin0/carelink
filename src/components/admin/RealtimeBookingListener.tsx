'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface NewBooking {
  id: string;
  customer_name: string;
  booking_date: string;
  start_time: string;
}

export default function RealtimeBookingListener({ facilityId }: { facilityId: string }) {
  const [newBookings, setNewBookings] = useState<NewBooking[]>([]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel('admin-bookings')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bookings',
          filter: `facility_id=eq.${facilityId}`,
        },
        (payload) => {
          const booking = payload.new as NewBooking;
          setNewBookings((prev) => [booking, ...prev].slice(0, 5));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [facilityId]);

  if (newBookings.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {newBookings.map((b) => (
        <div
          key={b.id}
          className="bg-white border-l-4 border-sky-500 shadow-lg rounded-lg p-4 animate-slide-in-right"
        >
          <p className="text-sm font-bold text-gray-800">新規予約</p>
          <p className="text-xs text-gray-600 mt-1">
            {b.customer_name}様 {b.booking_date} {b.start_time}〜
          </p>
        </div>
      ))}
    </div>
  );
}
