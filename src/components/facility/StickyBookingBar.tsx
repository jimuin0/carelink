'use client';

import Link from 'next/link';
import { analytics } from '@/lib/analytics';
import RemainingSlots from './RemainingSlots';

export default function StickyBookingBar({ phone, facilityName, facilitySlug, facilityId }: { phone: string | null; facilityName: string; facilitySlug: string; facilityId: string }) {
  return (
    <div className="sticky-bar">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-1">
          <RemainingSlots facilityId={facilityId} />
        </div>
        <div className="flex gap-3">
        {phone && (
          <a
            href={`tel:${phone}`}
            onClick={() => analytics.phoneClicked(facilitySlug)}
            className="flex items-center justify-center gap-2 py-3 px-4 bg-white border-2 border-sky-500 text-sky-600 font-bold rounded-xl text-sm transition-colors hover:bg-sky-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            電話
          </a>
        )}
        <Link
          href={`/facility/${facilitySlug}/booking`}
          onClick={() => analytics.bookingClicked(facilitySlug)}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          今すぐ予約する
        </Link>
        <button
          onClick={() => {
            const el = document.getElementById('contact-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex items-center justify-center gap-2 py-3 px-4 bg-white border-2 border-gray-300 text-gray-600 font-bold rounded-xl text-sm transition-colors hover:bg-gray-50"
          aria-label={`${facilityName}にお問い合わせ`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          問合せ
        </button>
        </div>
      </div>
    </div>
  );
}
