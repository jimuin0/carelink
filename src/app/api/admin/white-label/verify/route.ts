import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { promises as dns } from 'dns';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000, 'white-label-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 監査A2: white-label/route.tsと同一パターン。POSTはbody未読前提のためbodyから
  // facility_idを受け取る(空bodyでもJSONパース失敗を許容)。既存どおりservice roleで問い合わせる。
  const { facility_id } = await req.json().catch(() => ({} as { facility_id?: unknown }));
  const admin = createServiceRoleClient();
  const facilityIds = await getAdminFacilityIds(admin, user.id);
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, facility_id);
  if (reason === 'none') return NextResponse.json({ error: 'No facility' }, { status: 403 });
  if (reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (reason === 'ambiguous') return NextResponse.json({ error: '施設を指定してください', facilityIds }, { status: 400 });

  const { data: config } = await admin
    .from('white_label_domains')
    .select('domain, txt_record')
    .eq('facility_id', facilityId)
    .single();

  if (!config) return NextResponse.json({ error: 'No domain configured' }, { status: 400 });

  try {
    // Look up TXT records for _carelink-verify.<domain>
    const records = await dns.resolveTxt(`_carelink-verify.${config.domain}`);
    const flatRecords = records.flat();
    const verified = flatRecords.some((r) => r === config.txt_record);

    if (verified) {
      // config.txt_record は DB定義上 nullable（supabase/migrations/20260417000040_white_label.sql の
      // txt_record TEXT に NOT NULL 制約が無い）だが、verified===true はすぐ上の
      // flatRecords.some((r) => r === config.txt_record) が真になった場合のみ成立する。
      // flatRecords は dns.resolveTxt が返す文字列配列であり、文字列が === で null と一致することは
      // ないため、この分岐に到達した時点で config.txt_record は必ず非null（string）という不変条件がある。
      // TSはこの相関を追えないため防御的にガードする（実行時にこの分岐へ入ることはない）。
      if (config.txt_record === null) {
        console.error('[white-label/verify] verified=true だが txt_record が null（不変条件違反）', { facilityId });
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
      // 【恒久根治・TOCTOU】DNS解決(待機)の間にドメイン設定が変更され得る。facility_id だけで
      // update すると、待機中に別ドメイン/別TXTレコードへ差し替えられていても「検証済み」を
      // 立ててしまう（検証したのは古いドメインの TXT レコード）。update 条件に検証時点の
      // domain/txt_record を含め、その間に変更されていれば0行（更新されない）にする。
      const { data: updatedRows, error: verifyUpdateErr } = await admin
        .from('white_label_domains')
        .update({ is_verified: true, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('facility_id', facilityId)
        .eq('domain', config.domain)
        .eq('txt_record', config.txt_record)
        .select('facility_id');
      if (verifyUpdateErr) {
        console.error('[white-label/verify] domain verify update failed', { facilityId, err: verifyUpdateErr });
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
      if (!updatedRows || updatedRows.length === 0) {
        // 待機中にドメイン/TXTレコードが変更された＝検証は無効。古い設定に対する verified=true
        // を偽って返さず、正直に false（要再検証）を返す。
        return NextResponse.json({ verified: false, reason: 'Domain configuration changed during verification' });
      }
      void writeAuditLog({
        userId: user.id,
        facilityId,
        action: 'verify',
        tableName: 'white_label_domains',
        newValues: { domain: config.domain, is_verified: true },
        ipAddress: ip,
      });
    }

    return NextResponse.json({ verified });
  } catch {
    // DNS lookup failed
    return NextResponse.json({ verified: false, reason: 'DNS lookup failed' });
  }
}
