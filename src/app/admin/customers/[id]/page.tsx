import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getLedgerCustomerVisits } from '@/lib/admin';
import Breadcrumb from '@/components/Breadcrumb';
import { UUID_REGEX } from '@/lib/constants';
import { SbStatCard } from '@/components/admin/SbUi';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage(props: Props) {
  const params = await props.params;
  const id = params.id;
  // 顧客は master の id(UUID)で識別する。旧実装は email を URL パスに載せており、ブラウザ履歴・
  // アクセスログ・リファラに PII(メール)が平文で残っていた（8体監査 A5#3）。email は URL から外し
  // サーバ側でのみ扱う。
  if (!UUID_REGEX.test(id)) notFound();

  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  // 【監査M3】owner/admin である【全施設】を対象にする。旧実装は role フィルタ無し・
  // arbitrary limit(1) で先頭の1施設だけを選び、その施設スコープで顧客を引いていたため、
  // 複数施設に所属するオーナーが「先頭以外の施設」の顧客詳細を開くと該当施設が一致せず
  // 誤って 404 になっていた（詳細ページのみ role フィルタが無く単一施設に固定される非対称）。
  // owner/admin 限定で所属施設をすべて集め、そのいずれかに属する顧客を引く（テナント分離は維持）。
  // 一覧ページと同じ全owner/admin施設の範囲で照会し、施設をまたいだ顧客情報の混在を防ぐ。
  const { data: memberships } = await readPageResult(() => supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']), '/admin/customers/[id]');
  if (!memberships || memberships.length === 0) notFound();
  const facilityIds = memberships.map((m) => m.facility_id);

  // 施設スコープで顧客マスターを取得（自分が owner/admin の施設の顧客のみ・他施設は見せない）。
  const { data: customer } = await readPageResult(() => supabase
    .from('customers')
    .select('name, email, phone, facility_id')
    .eq('id', id)
    .in('facility_id', facilityIds)
    .maybeSingle(), '/admin/customers/[id]');
  if (!customer) notFound();

  // 来店履歴は一覧と同じ突合で引く。メールがあればメール（台帳でその電話番号を持つのが本人だけなら、
  // その電話番号のメール無し来店も合わせる）、無ければ電話番号（電話・来店受付のメール無し予約）。
  // どちらも無ければ照会しない（空の条件で施設の全来店を返さない）。施設は顧客が実際に属する facility_id。
  const visits = await getLedgerCustomerVisits(customer.facility_id, customer);
  const totalSpent = visits.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  return (
    <div>
      <Breadcrumb jsonLd={false} items={[{ label: '顧客管理', href: '/admin/customers' }, { label: '顧客詳細' }]} />
      <h1 className="text-2xl font-bold mb-2">顧客詳細</h1>
      <p className="text-sm font-medium mb-1">{customer.name}</p>
      <div className="mb-6">
        {customer.email && <p className="text-sm text-gray-600">{customer.email}</p>}
        {customer.phone && <p className="text-sm text-gray-600">{customer.phone}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <SbStatCard label="来店回数" value={visits.length} unit="回" accent="sky" />
        <SbStatCard label="合計売上" value={`¥${totalSpent.toLocaleString()}`} accent="emerald" />
      </div>

      <h2 className="font-bold mb-3">来店履歴</h2>
      {visits.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">来店履歴がありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <div key={v.id} className="bg-white rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{v.visit_date}</p>
                  {v.menu_name && <p className="text-xs text-gray-500">{v.menu_name}</p>}
                  {v.staff_name && <p className="text-xs text-gray-400">担当: {v.staff_name}</p>}
                </div>
                {v.amount !== null && (
                  <p className="font-bold">¥{v.amount.toLocaleString()}</p>
                )}
              </div>
              {v.note && <p className="text-xs text-gray-400 mt-2">{v.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
