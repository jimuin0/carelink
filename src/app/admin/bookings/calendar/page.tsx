import { redirect } from 'next/navigation';

// 予約台帳は廃止（PR #207）。旧 URL（ブックマーク・リロード・古いクライアントバンドル）への
// アクセスを 404 やローディング滞留にせず、予約一覧へクリーンに転送する恒久対策。
export default function BookingsCalendarRedirect() {
  redirect('/admin/bookings');
}
