import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

async function getAdminUserAndVerifyRoom(
  request: NextRequest,
  roomId: string
): Promise<{ userId: string; facilityId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the admin's facility
  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!membership) return null;

  // Verify the chat room belongs to this facility
  const admin = createServiceRoleClient();
  const { data: room } = await admin
    .from('chat_rooms')
    .select('id')
    .eq('id', roomId)
    .eq('facility_id', membership.facility_id)
    .single();

  if (!room) return null;
  return { userId: user.id, facilityId: membership.facility_id };
}

// POST: Send a message to a chat room
export async function POST(request: NextRequest, props: { params: Promise<{ roomId: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-chat-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.roomId)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const result = await getAdminUserAndVerifyRoom(request, params.roomId);
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();

  // Insert message
  const { data: message, error: msgError } = await admin.from('chat_messages').insert({
    room_id: params.roomId,
    sender_id: result.userId,
    content: parsed.data.content,
  }).select().single();

  if (msgError) return NextResponse.json({ error: 'メッセージの送信に失敗しました' }, { status: 500 });

  // Update room last_message_at (non-critical; message was already inserted)
  const { error: roomUpdateErr } = await admin.from('chat_rooms').update({ last_message_at: new Date().toISOString() }).eq('id', params.roomId);
  if (roomUpdateErr) console.error('[admin/chat] last_message_at update failed', { roomId: params.roomId, err: roomUpdateErr });

  return NextResponse.json({ message }, { status: 201 });
}

// PATCH: Mark messages as read
export async function PATCH(request: NextRequest, props: { params: Promise<{ roomId: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-chat-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.roomId)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const result = await getAdminUserAndVerifyRoom(request, params.roomId);
  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error: readErr } = await admin
    .from('chat_messages')
    .update({ is_read: true })
    .eq('room_id', params.roomId)
    .neq('sender_id', result.userId);
  if (readErr) {
    console.error('[admin/chat] mark-read update failed', { roomId: params.roomId, err: readErr });
    return NextResponse.json({ error: '既読更新に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
