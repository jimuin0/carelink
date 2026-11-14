import type { Database } from '@/types/database-overrides';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { saveAdminStaff } from '@/lib/admin-staff-write';

type StaffProfileUpdate = Database['public']['Tables']['staff_profiles']['Update'];

const staffUpdateSchema = z.object({
  name: z.string().min(1).max(50),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  nomination_fee: z.number().int().min(0).max(99999).optional(),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
  // 在籍/休止（false=休止）。退職者を物理削除せず休止にして公開ページ・予約枠・指名から外す。
  // 予約履歴の参照は保持したいので DELETE でなく is_active フラグで運用する。
  is_active: z.boolean().optional(),
  // 【2026年7月15日 HPB準拠仕様】担当メニュー(menu_staff)。undefined＝今回は同期しない・
  // 空配列＝担当制解除・非空＝プロフィールと同じトランザクションで置換。
  // coupon の target_menu_ids（#479）と同型。
  menu_ids: z.array(z.string().uuid()).max(200).optional(),
});


export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-staff-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = staffUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const menuIds = parsed.data.menu_ids;
  // is_active は指定された時のみ更新する。未指定の通常編集で在籍状態を勝手に戻さない
  // （休止中スタッフの名前だけ直す等で意図せず再在籍化するのを防ぐ）。
  // 🔴 Record<string, unknown> だと列名のタイポが tsc を素通りし、PostgREST が
  // 「そんな列は無い」で失敗しても error を握り潰していれば無音で保存されないままになる。
  // テーブルの Update 型を当てて、存在しない列名をここで落とす。
  // 🔴 送られていない列は載せない（RPC は jsonb_populate_record で現在値に重ねるので、
  //   載せなければ現在値のまま）。以前は未指定の bio・specialties 等を null/[]/0/false で
  //   上書きし、名前だけ直すと他の項目が無言で消えていた（低 A133）。
  const d = parsed.data;
  const updateFields: StaffProfileUpdate = { name: d.name };
  if (d.position !== undefined) updateFields.position = d.position;
  if (d.bio !== undefined) updateFields.bio = d.bio;
  if (d.specialties !== undefined) updateFields.specialties = d.specialties;
  if (d.years_experience !== undefined) updateFields.years_experience = d.years_experience;
  if (d.instagram_url !== undefined) updateFields.instagram_url = d.instagram_url || null;
  if (d.nomination_fee !== undefined) updateFields.nomination_fee = d.nomination_fee;
  if (d.line_works_channel_id !== undefined) updateFields.line_works_channel_id = d.line_works_channel_id;
  if (d.line_works_notify_all !== undefined) updateFields.line_works_notify_all = d.line_works_notify_all;
  if (parsed.data.is_active !== undefined) updateFields.is_active = parsed.data.is_active;
  const data = await saveAdminStaff({
    actorId: auth.userId, facilityId: auth.facilityId, staffId: params.id,
    values: updateFields, menuIds: menuIds ?? null,
  });
  if (data instanceof NextResponse) return data;

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'staff_profiles',
    recordId: params.id,
    newValues: {
      name: parsed.data.name,
      position: parsed.data.position ?? null,
      nomination_fee: parsed.data.nomination_fee ?? 0,
      ...(menuIds !== undefined ? { menu_ids: menuIds } : {}),
    },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ staff: data });
}
