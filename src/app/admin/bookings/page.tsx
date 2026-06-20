import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import type { Booking } from '@/types';
import { SbStatusChip, SbPageHeader, SbTable, SbThead, SbTh, SbTbody, SbTd } from '@/components/admin/SbUi';
import { isValidIsoDate, clampPage } from '@/lib/admin-date';
import { bookingsHref } from '@/lib/admin-bookings-url';

const PER_PAGE = 20;

interface Props {
  searchParams: Promise<{ status?: string; date?: string; page?: string }>;
}

export default async function AdminBookingsPage(props: Props) {
  const searchParams = await props.searchParams;
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  // 検証済みフィルタのみ採用（不正な status / 暦不正な date は無視し、ページURLにも伝播させない）
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  const statusFilter = searchParams.status && validStatuses.includes(searchParams.status) ? searchParams.status : null;
  const dateFilter = searchParams.date && isValidIsoDate(searchParams.date) ? searchParams.date : null;

  // 1) 件数のみ先に取得 → 総ページ数から page を [1, totalPages] にクランプ（?page=999 等の範囲外を最終ページへ丸め、偽の空ページを防ぐ）
  let countQuery = supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('facility_id', membership.facility_id);
  if (statusFilter) countQuery = countQuery.eq('status', statusFilter);
  if (dateFilter) countQuery = countQuery.eq('booking_date', dateFilter);

  const { count, error: countError } = await countQuery;
  // 取得失敗を「予約がありません」に偽装しない（error.tsx に委ねる）
  if (countError) {
    throw new Error(`予約件数の取得に失敗しました: ${countError.message}`);
  }
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = clampPage(searchParams.page, totalPages);
  const from = (page - 1) * PER_PAGE;
  const to = from + PER_PAGE - 1;

  // 2) クランプ後の page でデータ取得
  let dataQuery = supabase
    .from('bookings')
    .select('*')
    .eq('facility_id', membership.facility_id)
    .order('booking_date', { ascending: false })
    .range(from, to);
  if (statusFilter) dataQuery = dataQuery.eq('status', statusFilter);
  if (dateFilter) dataQuery = dataQuery.eq('booking_date', dateFilter);

  const { data, error } = await dataQuery;
  if (error) {
    throw new Error(`予約一覧の取得に失敗しました: ${error.message}`);
  }
  const bookings = (data ?? []) as Booking[];

  return (
    <div>
      <SbPageHeader
        title="予約管理"
        actions={<p className="text-sm text-gray-500">{total}件</p>}
      />

      {/* Filters（現在の date 絞り込みを保持したままステータスを切り替える） */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <FilterLink label="全て" href={bookingsHref({ date: dateFilter })} active={!statusFilter} />
        <FilterLink label="確認待ち" href={bookingsHref({ status: 'pending', date: dateFilter })} active={statusFilter === 'pending'} />
        <FilterLink label="確定" href={bookingsHref({ status: 'confirmed', date: dateFilter })} active={statusFilter === 'confirmed'} />
        <FilterLink label="完了" href={bookingsHref({ status: 'completed', date: dateFilter })} active={statusFilter === 'completed'} />
        <FilterLink label="キャンセル" href={bookingsHref({ status: 'cancelled', date: dateFilter })} active={statusFilter === 'cancelled'} />
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">予約がありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <SbTable>
            <SbThead>
              <SbTh>日時</SbTh>
              <SbTh>お客様</SbTh>
              <SbTh>ステータス</SbTh>
              <SbTh align="right">金額</SbTh>
            </SbThead>
            <SbTbody>
              {bookings.map((booking) => {
                return (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <SbTd>
                      <Link href={`/admin/bookings/${booking.id}`} className="hover:text-primary">
                        <p className="font-medium">{booking.booking_date}</p>
                        <p className="text-xs text-gray-500">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</p>
                      </Link>
                    </SbTd>
                    <SbTd>
                      <p>{booking.customer_name}</p>
                      <p className="text-xs text-gray-400">{booking.email}</p>
                    </SbTd>
                    <SbTd>
                      <SbStatusChip status={booking.status} />
                    </SbTd>
                    <SbTd align="right">
                      {booking.total_price !== null ? `¥${booking.total_price.toLocaleString()}` : '-'}
                    </SbTd>
                  </tr>
                );
              })}
            </SbTbody>
          </SbTable>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link href={bookingsHref({ status: statusFilter, date: dateFilter, page: page - 1 })} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">前へ</Link>
          )}
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={bookingsHref({ status: statusFilter, date: dateFilter, page: page + 1 })} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">次へ</Link>
          )}
        </div>
      )}
    </div>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`text-sm px-4 py-2 rounded-full whitespace-nowrap ${
        active ? 'bg-primary text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  );
}
