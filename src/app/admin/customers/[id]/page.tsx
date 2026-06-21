import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getCustomerVisits } from '@/lib/admin';
import Breadcrumb from '@/components/Breadcrumb';
import { UUID_REGEX } from '@/lib/constants';

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

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  // 施設スコープで顧客マスターを取得（他施設の顧客は見せない）。
  const { data: customer } = await supabase
    .from('customers')
    .select('name, email')
    .eq('id', id)
    .eq('facility_id', membership.facility_id)
    .single();
  if (!customer) notFound();

  // 来店履歴は email キー。email 未登録の顧客で getCustomerVisits を空 email で呼ぶと施設の全来店が
  // 返ってしまうため、email がある時のみ照会する。
  const visits = customer.email
    ? await getCustomerVisits(membership.facility_id, customer.email)
    : [];
  const totalSpent = visits.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  return (
    <div>
      <Breadcrumb jsonLd={false} items={[{ label: '顧客管理', href: '/admin/customers' }, { label: '顧客詳細' }]} />
      <h1 className="text-2xl font-bold mb-2">顧客詳細</h1>
      <p className="text-sm font-medium mb-1">{customer.name}</p>
      {customer.email && <p className="text-sm text-gray-500 mb-6">{customer.email}</p>}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">来店回数</p>
          <p className="text-2xl font-bold">{visits.length}回</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">合計売上</p>
          <p className="text-2xl font-bold">¥{totalSpent.toLocaleString()}</p>
        </div>
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
