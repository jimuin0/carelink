import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { isSalonIntentProof } from '@/lib/salon-submission-proof';
import { listSalonRecovery, prepareSalonRecovery, readSalonRecovery,
  salonRecoveryCookieName, salonRecoveryInput, SALON_RECOVERY_TTL } from '@/lib/salon-recovery';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export const POST = withRoute(async (request, ctx) => {
  const parsed = salonRecoveryInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ state: 'invalid' }, { status: 400, headers });
  const user = ctx.user!;
  if (!user.email_confirmed_at) return NextResponse.json({ state: 'unverified',
    error: '申込に使用したメールアドレスの確認を完了してください。' }, { status: 403, headers });
  const input = parsed.data;
  const db = createServiceRoleClient();
  if (input.action === 'list') {
    const result = await listSalonRecovery(db, user.id, input.after);
    return NextResponse.json(result, { status: result.state === 'unverified' ? 403 : 200, headers });
  }
  if (input.action === 'prepare') {
    const recoveryId = randomUUID();
    const proof = randomBytes(32).toString('hex');
    const result = await prepareSalonRecovery(db, user.id, input.receiptId, recoveryId, proof);
    const response = NextResponse.json(result, { status: result.state === 'unverified' ? 403 : 200, headers });
    if (result.state === 'prepared') response.cookies.set(salonRecoveryCookieName(recoveryId), proof, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      maxAge: Math.max(0, Math.min(SALON_RECOVERY_TTL, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000))),
    });
    return response;
  }
  const proof = new NextRequest(request.url, { headers: request.headers }).cookies.get(salonRecoveryCookieName(input.recoveryId))?.value;
  if (!isSalonIntentProof(proof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  const result = await readSalonRecovery(db, user.id, input.recoveryId, proof);
  return NextResponse.json(result, { status: result.state === 'unverified' ? 403 : 200, headers });
}, { csrf: true, requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 20, windowMs: 60_000, prefix: 'salon-recovery' }, sentryTag: 'salon-recovery' });
