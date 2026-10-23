import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getFacilityCustomerLedger, getUniqueCustomers } from '@/lib/admin';
import { buildCustomerDirectory, type MasterCustomer, type SegmentRow, type UnregisteredCustomer } from '@/lib/customer-directory';
import { notFound } from 'next/navigation';
import { SbPageHeader } from '@/components/admin/SbUi';
import CustomersManager from '@/components/admin/CustomersManager';

export default async function AdminCustomersPage() {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  // 【監査M3】owner/admin である【全施設】を対象にする。旧実装は .limit(1).single() で先頭1施設のみ
  // 表示し、複数施設オーナーは他施設の顧客が一覧に出なかった。全所属施設(owner/admin)を取得し、
  // 顧客マスター・来店・セグメントを【施設ごとに突合】して集約する（施設を跨いだ email 突合は
  // 別施設の来店を誤って混ぜるため必ず facility 単位で行う）。追加/編集/削除は各顧客の
  // facility_id を用いる（CustomersManager 側で施設セレクタ・行の施設スコープを扱う）。
  const { data: membershipRows } = await readPageResult(() => supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']), '/admin/customers');
  if (!membershipRows || membershipRows.length === 0) notFound();
  const facilityIds = Array.from(new Set(membershipRows.map((m) => m.facility_id)));

  // 施設名（一覧の施設列・追加フォームの施設セレクタ用）。公開/非公開を問わず自施設は表示する。
  const { data: facilityRows } = await readPageResult(() => supabase
    .from('facility_profiles')
    .select('id, name')
    .in('id', facilityIds), '/admin/customers');
  const facilityNameById = new Map<string, string>(
    (facilityRows ?? []).map((f) => [f.id as string, (f.name as string) ?? '施設']),
  );
  const facilities = facilityIds.map((id) => ({ id, name: facilityNameById.get(id) ?? '施設' }));

  const customers: MasterCustomer[] = [];
  const unregistered: UnregisteredCustomer[] = [];

  // 施設ごとに突合して集約（施設単位でないと別施設の来店・セグメントを誤って混ぜる）。
  for (const facilityId of facilityIds) {
    const facilityName = facilityNameById.get(facilityId) ?? '施設';

    // 顧客マスター（手入力台帳）を全件読む（1000 件で切れると、詳細・RFM 集計と電話番号での来店の寄せ方が
    // 食い違う）。テーブル未適用環境（migration 未実行）では空にフォールバックして画面を落とさない
    // （PGRST205 / 42P01＝テーブル不在）。それ以外のエラーは error.tsx に委ねる。
    const ledger = await getFacilityCustomerLedger(facilityId);

    // 来店実績（予約完了から自動集計）。同じ人かはメール（canonical）で、メールの無い電話・来店受付の
    // 予約は電話番号で判定する（customerIdentityKey・src/lib/customer-identity.ts）。
    const visits = await getUniqueCustomers(facilityId);

    // RFMセグメント（VIP/レギュラー/離脱リスク/離脱/新規）と累計利用金額(LTV)を一覧の各行に出す。
    const { data: segmentRows, error: segmentErr } = await supabase
      .from('customer_segments')
      .select('customer_email, segment, total_spent')
      .eq('facility_id', facilityId);
    if (segmentErr && segmentErr.code !== 'PGRST205' && segmentErr.code !== '42P01') {
      throw new Error(`顧客セグメントの取得に失敗しました: ${segmentErr.message}`);
    }

    // 台帳・来店・セグメントをこの施設の中で突合する（来店の無い台帳顧客には古いセグメントを出さない）。
    const directory = buildCustomerDirectory({
      facilityId, facilityName, ledger, visits, segments: (segmentRows ?? []) as SegmentRow[],
    });
    customers.push(...directory.customers);
    unregistered.push(...directory.unregistered);
  }

  return (
    <div>
      <SbPageHeader title="顧客管理" />
      <CustomersManager facilities={facilities} customers={customers} unregistered={unregistered} />
    </div>
  );
}
