import Link from 'next/link';
import PushPermissionBanner from '@/components/push/PushPermissionBanner';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ id?: string; date?: string; time?: string; end_time?: string; facility?: string; has_intake?: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// iCal(RFC 5545) の TEXT 値エスケープ。施設名はオーナー制御で「,」「;」「\」改行を含み得るため、
// SUMMARY へ素で埋め込むと .ics が壊れる（API 側 api/booking/[id]/ical と同一処理）。
// encodeURIComponent は data URI 用で iCal TEXT エスケープではない（別物）。
function escapeIcal(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function buildIcsContent(date?: string, time?: string, endTime?: string, facility?: string, bookingId?: string): string | null {
  if (!date || !time || !DATE_RE.test(date) || !TIME_RE.test(time)) return null;

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const [h, m] = time.split(':');
  const dtStart = date.replace(/-/g, '') + 'T' + h.padStart(2, '0') + m.padStart(2, '0') + '00';

  let dtEnd: string;
  if (endTime && TIME_RE.test(endTime)) {
    const [eh, em] = endTime.split(':');
    dtEnd = date.replace(/-/g, '') + 'T' + eh.padStart(2, '0') + em.padStart(2, '0') + '00';
  } else {
    // Fallback: +1 hour with proper day rollover
    const startDate = new Date(`${date}T${time}:00`);
    startDate.setHours(startDate.getHours() + 1);
    const ey = startDate.getFullYear();
    const emo = String(startDate.getMonth() + 1).padStart(2, '0');
    const ed = String(startDate.getDate()).padStart(2, '0');
    const eho = String(startDate.getHours()).padStart(2, '0');
    const emi = String(startDate.getMinutes()).padStart(2, '0');
    dtEnd = `${ey}${emo}${ed}T${eho}${emi}00`;
  }

  const summary = facility ? `${escapeIcal(facility)} 予約` : 'CareLink 予約';
  const uid = bookingId || crypto.randomUUID();

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareLink//Booking//JA',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}@carelink-jp.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Tokyo:${dtStart}`,
    `DTEND;TZID=Asia/Tokyo:${dtEnd}`,
    `SUMMARY:${summary}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export default async function BookingCompletePage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const bookingId = searchParams.id;
  const hasIntakeForm = searchParams.has_intake === '1';
  const icsContent = buildIcsContent(searchParams.date, searchParams.time, searchParams.end_time, searchParams.facility, bookingId);
  const icsDataUri = icsContent ? `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}` : null;

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2">予約を受け付けました</h1>
          {bookingId && (
            <p className="text-xs text-gray-400 mb-1 font-mono">予約番号: {bookingId.slice(0, 8).toUpperCase()}</p>
          )}
          <p className="text-sm text-gray-500 mb-6">
            ご登録のメールアドレスに確認メールをお送りしました。
            施設からの確認をお待ちください。
          </p>
          <div className="space-y-3">
            {/* 問診票バナー */}
            {hasIntakeForm && (
              <Link
                href={`/intake/${params.slug}${bookingId ? `?booking_id=${bookingId}` : ''}`}
                className="block w-full text-center text-sm py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 font-bold hover:bg-amber-100 transition-colors"
              >
                📋 来院前に問診票を記入する（推奨）
              </Link>
            )}
            <Link href={`/facility/${params.slug}`} className="btn-primary block w-full !py-3">
              施設ページに戻る
            </Link>
            {icsDataUri && (
              <a
                href={icsDataUri}
                download="carelink-booking.ics"
                className="block w-full text-center text-sm py-2.5 border border-sky-200 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors"
              >
                カレンダーに追加（.ics）
              </a>
            )}
            <Link href="/mypage/bookings" className="block text-sm text-primary hover:underline">
              予約履歴を確認
            </Link>
          </div>
        </div>
      </div>
      <PushPermissionBanner />
    </div>
  );
}
