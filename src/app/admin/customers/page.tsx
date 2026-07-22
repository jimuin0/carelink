import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getUniqueCustomers } from '@/lib/admin';
import { canonicalizeEmail } from '@/lib/email-canonical';
import { notFound } from 'next/navigation';
import { SbPageHeader } from '@/components/admin/SbUi';
import CustomersManager, { type MasterCustomer, type UnregisteredCustomer } from '@/components/admin/CustomersManager';

export default async function AdminCustomersPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // 【監査M3】owner/admin である【全施設】を対象にする。旧実装は .limit(1).single() で先頭1施設のみ
  // 表示し、複数施設オーナーは他施設の顧客が一覧に出なかった。全所属施設(owner/admin)を取得し、
  // 顧客マスター・来店・セグメントを【施設ごとに突合】して集約する（施設を跨いだ email 突合は
  // 別施設の来店を誤って混ぜるため必ず facility 単位で行う）。追加/編集/削除は各顧客の
  // facility_id を用いる（CustomersManager 側で施設セレクタ・行の施設スコープを扱う）。
  const { data: membershipRows } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);
  if (!membershipRows || membershipRows.length === 0) notFound();
  const facilityIds = Array.from(new Set(membershipRows.map((m) => m.facility_id)));

  // 施設名（一覧の施設列・追加フォームの施設セレクタ用）。公開/非公開を問わず自施設は表示する。
  const { data: facilityRows } = await supabase
    .from('facility_profiles')
    .select('id, name')
    .in('id', facilityIds);
  const facilityNameById = new Map<string, string>(
    (facilityRows ?? []).map((f) => [f.id as string, (f.name as string) ?? '施設']),
  );
  const facilities = facilityIds.map((id) => ({ id, name: facilityNameById.get(id) ?? '施設' }));

  const customers: MasterCustomer[] = [];
  const unregistered: UnregisteredCustomer[] = [];

  // 施設ごとに突合して集約（施設単位でないと別施設の来店・セグメントを誤って混ぜる）。
  for (const facilityId of facilityIds) {
    const facilityName = facilityNameById.get(facilityId) ?? '施設';

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
    const master = (masterRows ?? []) as Omit<MasterCustomer, 'visit_count' | 'last_visit' | 'segment' | 'total_spent' | 'facility_id' | 'facility_name'>[];

    // 来店実績（予約完了から自動集計・email 正規化キー）。
    // 【監査L3】突合キーは canonicalizeEmail に統一する（trim+小文字化だけでは Gmail の
    // ドット/+タグ エイリアスが別人扱いになり、来店実績・LTV・セグメントが一覧に出なかった）。
    // 同一人物が複数エイリアスで来店している場合は canonical キーで合算する（来店数を過少にしない）。
    const visits = await getUniqueCustomers(facilityId);
    const visitByEmail = new Map<string, { visit_count: number; last_visit: string }>();
    for (const v of visits) {
      if (!v.email) continue;
      const key = canonicalizeEmail(v.email);
      const existing = visitByEmail.get(key);
      if (existing) {
        visitByEmail.set(key, {
          visit_count: existing.visit_count + v.visit_count,
          last_visit: existing.last_visit >= v.last_visit ? existing.last_visit : v.last_visit,
        });
      } else {
        visitByEmail.set(key, { visit_count: v.visit_count, last_visit: v.last_visit });
      }
    }

    // RFMセグメント（VIP/レギュラー/離脱リスク/離脱/新規）と累計利用金額(LTV)を一覧の各行に出す。
    const { data: segmentRows, error: segmentErr } = await supabase
      .from('customer_segments')
      .select('customer_email, segment, total_spent')
      .eq('facility_id', facilityId);
    if (segmentErr && segmentErr.code !== 'PGRST205' && segmentErr.code !== '42P01') {
      throw new Error(`顧客セグメントの取得に失敗しました: ${segmentErr.message}`);
    }
    const segmentByEmail = new Map<string, { segment: string | null; total_spent: number | null }>();
    for (const s of (segmentRows ?? []) as Array<{ customer_email: string; segment: string | null; total_spent: number | null }>) {
      // 【監査L3】segment 側も canonical キーで突合し、Gmail エイリアス顧客の LTV/セグメントを一覧に出す。
      if (s.customer_email) segmentByEmail.set(canonicalizeEmail(s.customer_email), { segment: s.segment, total_spent: s.total_spent });
    }

    // マスター顧客に来店実績・セグメントを突合（email 一致・この施設内）。
    const matchedEmails = new Set<string>();
    for (const c of master) {
      // 【監査L3】master 側も canonical キーで突合する（両側 canonical で Gmail エイリアスも一致）。
      const key = c.email ? canonicalizeEmail(c.email) : '';
      const hit = key ? visitByEmail.get(key) : undefined;
      const seg = key ? segmentByEmail.get(key) : undefined;
      if (key && hit) matchedEmails.add(key);
      customers.push({
        ...c,
        facility_id: facilityId,
        facility_name: facilityName,
        visit_count: hit?.visit_count ?? 0,
        last_visit: hit?.last_visit ?? null,
        segment: seg?.segment ?? null,
        total_spent: seg?.total_spent ?? null,
      });
    }

    // 来店履歴はあるがマスター未登録の顧客（「登録」導線を出す・この施設内）。
    for (const v of visits) {
      if (v.email && matchedEmails.has(canonicalizeEmail(v.email))) continue;
      unregistered.push({ name: v.name, email: v.email, visit_count: v.visit_count, last_visit: v.last_visit, facility_id: facilityId, facility_name: facilityName });
    }
  }

  return (
    <div>
      <SbPageHeader title="顧客管理" />
      <CustomersManager facilities={facilities} customers={customers} unregistered={unregistered} />
    </div>
  );
}
