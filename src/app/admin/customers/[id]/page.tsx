import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getCustomerVisits } from '@/lib/admin';
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // 【監査M3】owner/admin である【全施設】を対象にする。旧実装は role フィルタ無し・
  // arbitrary limit(1) で先頭の1施設だけを選び、その施設スコープで顧客を引いていたため、
  // 複数施設に所属するオーナーが「先頭以外の施設」の顧客詳細を開くと該当施設が一致せず
  // 誤って 404 になっていた（詳細ページのみ role フィルタが無く単一施設に固定される非対称）。
  // owner/admin 限定で所属施設をすべて集め、そのいずれかに属する顧客を引く（テナント分離は維持）。
  // 注：一覧ページ(page.tsx)は現状 .in('role',...).limit(1).single() で単一施設のみを表示する既存
  // 制約が残る（複数施設の全顧客一覧は未対応）。詳細への導線は一覧の各行からのみのため facility は
  // 常に一致し 404 は解消する。全施設一覧化は別タスク（監査M3 low #12）。
  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);
  if (!memberships || memberships.length === 0) notFound();
  const facilityIds = memberships.map((m) => m.facility_id);

  // 施設スコープで顧客マスターを取得（自分が owner/admin の施設の顧客のみ・他施設は見せない）。
  const { data: customer } = await supabase
    .from('customers')
    .select('name, email, facility_id')
    .eq('id', id)
    .in('facility_id', facilityIds)
    .single();
  if (!customer) notFound();

  // 来店履歴は email キー。email 未登録の顧客で getCustomerVisits を空 email で呼ぶと施設の全来店が
  // 返ってしまうため、email がある時のみ照会する。施設は顧客が実際に属する facility_id を使う。
  const visits = customer.email
    ? await getCustomerVisits(customer.facility_id, customer.email)
    : [];
  const totalSpent = visits.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  return (
    <div>
      <Breadcrumb jsonLd={false} items={[{ label: '顧客管理', href: '/admin/customers' }, { label: '顧客詳細' }]} />
      <h1 className="text-2xl font-bold mb-2">顧客詳細</h1>
      <p className="text-sm font-medium mb-1">{customer.name}</p>
      {customer.email && <p className="text-sm text-gray-500 mb-6">{customer.email}</p>}

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
            <div key={v.id} className="bg-white rounded-xl p-4 shadow-sm">
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
