import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';
import { readWorkingStaff } from '@/lib/facility-publish-gate';

type StaffRow = { id: string; name: string; position: string | null; specialties: string[] | null; is_active: boolean };

export default async function AdminStaffPage(props: { searchParams: Promise<{ facility_id?: string }> }) {
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (verification.state !== 'verified') notFound();
  const searchParams = await props.searchParams;
  const { choices, selectedId: facilityId } = await loadAdminFacilitySelection(supabase, verification.user.id, searchParams.facility_id ?? null);
  const selector = <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/staff" />;
  if (!facilityId) return <div><SbPageHeader title="スタッフ管理" />{selector}</div>;
  const facilityHref = (path: string) => `${path}${path.includes('?') ? '&' : '?'}facility_id=${facilityId}`;


  // 管理一覧は休止(is_active=false)スタッフも含めて全件表示する。公開用の getStaffByFacility は
  // active のみ返すため、これを使うと休止スタッフが一覧から消え、再開する術が無くなる。
  // 在籍→休止の順、同区分内は sort_order。取得失敗は 0 件に偽装せず error.tsx へ委ねる。
  // スタッフを追加しただけでは勤務は作られない（勤務時間を保存するまで予約枠が出ない）。
  // 勤務時間が無い（週間の勤務日も、今日以降に勤務する特別日も無い）在籍スタッフを一覧で示し、
  // そのまま勤務の画面へ導く。判定は予約枠・検索カードと同じ規則。読めなければ例外（未登録と偽装しない）。
  const [{ data, error }, working] = await Promise.all([
    supabase
      .from('staff_profiles')
      .select('id, name, position, specialties, is_active')
      .eq('facility_id', facilityId)
      .order('is_active', { ascending: false })
      .order('sort_order'),
    readWorkingStaff(supabase, facilityId),
  ]);
  if (error) throw new Error(`スタッフ一覧の取得に失敗しました: ${error.message}`);
  const staff = (data ?? []) as StaffRow[];
  const scheduled = working.workingIds;

  return (
    <div>
      {selector}
      <SbPageHeader
        title="スタッフ管理"
        actions={<Link href={facilityHref("/admin/staff/new")} className="btn-primary text-sm py-2! px-4!">追加</Link>}
      />

      {staff.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center">
          <p className="text-3xl mb-3">👤</p>
          <p className="text-gray-600 font-medium mb-1">まだスタッフが登録されていません</p>
          <p className="text-sm text-gray-500 mb-5">スタッフを登録して勤務時間を保存すると予約枠が作られ、お客様が指名予約できるようになります。</p>
          <Link href={facilityHref("/admin/staff/new")} className="btn-primary text-sm py-2.5! px-6!">最初のスタッフを追加</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {staff.map((s) => (
            <div
              key={s.id}
              className={`bg-white rounded-xl p-4 shadow-xs ${s.is_active ? '' : 'opacity-60'}`}
            >
              <Link href={facilityHref(`/admin/staff/${s.id}/edit`)} className="block hover:opacity-80">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-bold">
                    {s.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold truncate">{s.name}</p>
                      {!s.is_active && <span className="shrink-0 text-micro bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-bold">休止中</span>}
                    </div>
                    {s.position && <p className="text-xs text-gray-500">{s.position}</p>}
                  </div>
                </div>
                {s.is_active && !scheduled.has(s.id) && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-bold">勤務時間が未登録です。</span>保存するまで、このスタッフはネット予約を受けられず、予約表の「指名なし」の予約にも割り当てられません。
                  </p>
                )}
                {(s.specialties?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {s.specialties?.slice(0, 3).map((sp) => (
                      <span key={sp} className="text-micro bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {sp}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
              <div className="flex gap-3 mt-3 pt-3 border-t">
                <Link href={facilityHref(`/admin/staff/${s.id}/edit`)} className="text-xs text-primary hover:underline">編集</Link>
                {s.is_active && !scheduled.has(s.id)
                  ? <Link href={facilityHref(`/admin/staff/${s.id}/schedule`)} className="text-xs font-bold text-amber-800 hover:underline">勤務時間を登録する</Link>
                  : <Link href={facilityHref(`/admin/staff/${s.id}/schedule`)} className="text-xs text-gray-500 hover:underline">スケジュール</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
