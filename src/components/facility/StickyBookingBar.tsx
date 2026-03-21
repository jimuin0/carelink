'use client';

export default function StickyBookingBar({ phone, facilityName }: { phone: string | null; facilityName: string }) {
  return (
    <div className="sticky-bar">
      <div className="max-w-3xl mx-auto flex gap-3">
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white border-2 border-sky-500 text-sky-600 font-bold rounded-xl text-sm transition-colors hover:bg-sky-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            電話する
          </a>
        )}
        <button
          onClick={() => {
            const el = document.getElementById('contact-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="flex-1 flex items-center justify-center gap-2 py-3 text-white font-bold rounded-xl text-sm transition-colors"
          style={{ backgroundColor: 'var(--primary)' }}
          aria-label={`${facilityName}にお問い合わせ`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          お問い合わせ
        </button>
      </div>
    </div>
  );
}
