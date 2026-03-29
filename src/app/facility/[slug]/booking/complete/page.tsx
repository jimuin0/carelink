import Link from 'next/link';

interface Props {
  params: { slug: string };
  searchParams: { id?: string };
}

export default function BookingCompletePage({ params, searchParams }: Props) {
  const bookingId = searchParams.id;

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
            <Link href={`/facility/${params.slug}`} className="btn-primary block w-full !py-3">
              施設ページに戻る
            </Link>
            <Link href="/mypage/bookings" className="block text-sm text-primary hover:underline">
              予約履歴を確認
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
