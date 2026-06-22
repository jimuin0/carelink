import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import { SbStatusChip, SbPageHeader, SbTable, SbThead, SbTh, SbTbody, SbTd } from '@/components/admin/SbUi';
import { isValidIsoDate, clampPage } from '@/lib/admin-date';
import { bookingsHref } from '@/lib/admin-bookings-url';
import { UUID_REGEX } from '@/lib/constants';
import BookingsSearchForm from '@/components/admin/BookingsSearchForm';

const PER_PAGE = 20;
const VALID_STATUSES = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'];

interface Props {
  searchParams: Promise<{ from?: string; to?: string; status?: string; q?: string; staff?: string; page?: string }>;
}

// 埋め込み（menu/staff）の生成型と手動キャストが競合するため、bookings は非型付き select で取得し本型へキャスト。
type BookingRow = {
  id: string; booking_date: string; start_time: string; end_time: string;
  customer_name: string; email: string | null; status: string; total_price: number | null;
  menu: { name: string } | { name: string }[] | null;
  staff: { name: string } | { name: string }[] | null;
};

function embedName(v: { name: string } | { name: string }[] | null): string | null {
  const o = Array.isArray(v) ? v[0] : v;
  return o?.name ?? null;
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
  const facilityId = membership.facility_id;

  // 検証済みフィルタのみ採用（不正値は無視し URL にも伝播させない）
  const from = searchParams.from && isValidIsoDate(searchParams.from) ? searchParams.from : null;
  const to = searchParams.to && isValidIsoDate(searchParams.to) ? searchParams.to : null;
  const statuses = (searchParams.status ?? '').split(',').map((s) => s.trim()).filter((s) => VALID_STATUSES.includes(s));
  const q = searchParams.q ? searchParams.q.trim().slice(0, 100) : '';
  const staff = searchParams.staff && UUID_REGEX.test(searchParams.staff) ? searchParams.staff : null;

  // スタッフ絞り込み用の一覧（is_active・sort_order 順）
  const { data: staffRows, error: staffErr } = await supabase
    .from('staff_profiles')
    .select('id, name')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (staffErr) {
    throw new Error(`スタッフ一覧の取得に失敗しました: ${staffErr.message}`);
  }
  const staffList = (staffRows ?? []) as { id: string; name: string }[];

  // 1) 件数 → 総ページ数で page をクランプ（範囲外を最終ページへ丸め偽の空ページを防ぐ）。
  //    フィルタは count / data 双方へ同順で適用する（取りこぼし防止）。
  let countQuery = supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId);
  if (from) countQuery = countQuery.gte('booking_date', from);
  if (to) countQuery = countQuery.lte('booking_date', to);
  if (statuses.length > 0) countQuery = countQuery.in('status', statuses);
  if (q) countQuery = countQuery.ilike('customer_name', `%${q}%`);
  if (staff) countQuery = countQuery.eq('staff_id', staff);

  const { count, error: countError } = await countQuery;
  if (countError) {
    throw new Error(`予約件数の取得に失敗しました: ${countError.message}`);
  }
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = clampPage(searchParams.page, totalPages);
  const fromRow = (page - 1) * PER_PAGE;

  // 2) データ取得（メニュー名・スタッフ名を埋め込み）
  let dataQuery = supabase
    .from('bookings')
    .select('id, booking_date, start_time, end_time, customer_name, email, status, total_price, menu:facility_menus(name), staff:staff_profiles(name)')
    .eq('facility_id', facilityId);
  if (from) dataQuery = dataQuery.gte('booking_date', from);
  if (to) dataQuery = dataQuery.lte('booking_date', to);
  if (statuses.length > 0) dataQuery = dataQuery.in('status', statuses);
  if (q) dataQuery = dataQuery.ilike('customer_name', `%${q}%`);
  if (staff) dataQuery = dataQuery.eq('staff_id', staff);

  const { data, error } = await dataQuery
    .order('booking_date', { ascending: false })
    .order('start_time', { ascending: false })
    .range(fromRow, fromRow + PER_PAGE - 1);
  if (error) {
    throw new Error(`予約一覧の取得に失敗しました: ${error.message}`);
  }
  const bookings = (data ?? []) as unknown as BookingRow[];

  const baseFilters = { from, to, statuses, q: q || null, staff };

  return (
    <div>
      <SbPageHeader title="予約一覧" actions={<p className="text-sm text-gray-500">{total}件</p>} />

      <BookingsSearchForm
        initial={{ from: from ?? '', to: to ?? '', statuses, q, staff: staff ?? '' }}
        staffList={staffList}
      />

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">条件に合う予約がありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <SbTable>
            <SbThead>
              <SbTh>来店日時</SbTh>
              <SbTh>お客様</SbTh>
              <SbTh>スタッフ</SbTh>
              <SbTh>メニュー</SbTh>
              <SbTh>ステータス</SbTh>
              <SbTh align="right">金額</SbTh>
            </SbThead>
            <SbTbody>
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <SbTd>
                    <Link href={`/admin/bookings/${b.id}`} className="hover:text-primary">
                      <p className="font-medium whitespace-nowrap">{b.booking_date}</p>
                      <p className="text-xs text-gray-500">{b.start_time?.slice(0, 5)}〜{b.end_time?.slice(0, 5)}</p>
                    </Link>
                  </SbTd>
                  <SbTd>
                    <p>{b.customer_name}</p>
                    <p className="text-xs text-gray-400">{b.email}</p>
                  </SbTd>
                  <SbTd className="text-gray-600 text-sm">{embedName(b.staff) ?? '指名なし'}</SbTd>
                  <SbTd className="text-gray-600 text-sm">{embedName(b.menu) ?? '-'}</SbTd>
                  <SbTd><SbStatusChip status={b.status} /></SbTd>
                  <SbTd align="right">{b.total_price !== null ? `¥${b.total_price.toLocaleString()}` : '-'}</SbTd>
                </tr>
              ))}
            </SbTbody>
          </SbTable>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link href={bookingsHref({ ...baseFilters, page: page - 1 })} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">前へ</Link>
          )}
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={bookingsHref({ ...baseFilters, page: page + 1 })} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">次へ</Link>
          )}
        </div>
      )}
    </div>
  );
}
