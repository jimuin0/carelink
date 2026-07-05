import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getUniqueCustomers } from '@/lib/admin';
import { notFound } from 'next/navigation';
import { SbPageHeader } from '@/components/admin/SbUi';
import CustomersManager, { type MasterCustomer, type UnregisteredCustomer } from '@/components/admin/CustomersManager';

export default async function AdminCustomersPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!membership) notFound();

  const facilityId = membership.facility_id;

  // 顧客マスター（手入力台帳）。テーブル未適用環境（migration 未実行）では空にフォールバック
  // して画面を落とさない（PGRST205 / 42P01＝テーブル不在）。それ以外のエラーは error.tsx に委ねる。
  const { data: masterRows, error: masterErr } = await supabase
    .from('customers')
    .select('id, name, name_kana, email, phone, birthday, gender, notes')
    .eq('facility_id', facilityId)
    .order('name', { ascending: true });
  if (masterErr && masterErr.code !== 'PGRST205' && masterErr.code !== '42P01') {
    throw new Error(`顧客マスターの取得に失敗しました: ${masterErr.message}`);
  }
  const master = (masterRows ?? []) as Omit<MasterCustomer, 'visit_count' | 'last_visit' | 'segment' | 'total_spent'>[];

  // 来店実績（予約完了から自動集計・email 正規化キー）。
  const visits = await getUniqueCustomers(facilityId);
  const visitByEmail = new Map<string, { visit_count: number; last_visit: string }>();
  for (const v of visits) {
    if (v.email) visitByEmail.set(v.email.trim().toLowerCase(), { visit_count: v.visit_count, last_visit: v.last_visit });
  }

  // 監査対応: customer-segment cron が週次計算するRFMセグメント(VIP/レギュラー/離脱リスク/離脱/新規)
  // と累計利用金額(LTV相当)は customer_segments テーブルに存在するが、これまで顧客一覧の各行に
  // 表示されておらず、admin/analytics の全体分布グラフでしか見えなかった（経営者が「上位顧客を
  // 一目で見つけて優遇する」入口が欠けていた）。email正規化キーで突合し一覧に出す。
  const { data: segmentRows, error: segmentErr } = await supabase
    .from('customer_segments')
    .select('customer_email, segment, total_spent')
    .eq('facility_id', facilityId);
  if (segmentErr && segmentErr.code !== 'PGRST205' && segmentErr.code !== '42P01') {
    throw new Error(`顧客セグメントの取得に失敗しました: ${segmentErr.message}`);
  }
  const segmentByEmail = new Map<string, { segment: string | null; total_spent: number | null }>();
  for (const s of (segmentRows ?? []) as Array<{ customer_email: string; segment: string | null; total_spent: number | null }>) {
    if (s.customer_email) segmentByEmail.set(s.customer_email.trim().toLowerCase(), { segment: s.segment, total_spent: s.total_spent });
  }

  // マスター顧客に来店実績・セグメントを突合（email 一致）。
  const matchedEmails = new Set<string>();
  const customers: MasterCustomer[] = master.map((c) => {
    const key = c.email ? c.email.trim().toLowerCase() : '';
    const hit = key ? visitByEmail.get(key) : undefined;
    const seg = key ? segmentByEmail.get(key) : undefined;
    if (key && hit) matchedEmails.add(key);
    return {
      ...c,
      visit_count: hit?.visit_count ?? 0,
      last_visit: hit?.last_visit ?? null,
      segment: seg?.segment ?? null,
      total_spent: seg?.total_spent ?? null,
    };
  });

  // 来店履歴はあるがマスター未登録の顧客（「登録」導線を出す）。
  const unregistered: UnregisteredCustomer[] = visits
    .filter((v) => !v.email || !matchedEmails.has(v.email.trim().toLowerCase()))
    .map((v) => ({ name: v.name, email: v.email, visit_count: v.visit_count, last_visit: v.last_visit }));

  return (
    <div>
      <SbPageHeader title="顧客管理" />
      <CustomersManager facilityId={facilityId} customers={customers} unregistered={unregistered} />
    </div>
  );
}
