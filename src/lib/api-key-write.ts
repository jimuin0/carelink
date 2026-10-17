import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import type { Json } from '@/types/database.types';

// Explicit projection: a compromised/incorrect receipt must never expose key_hash.
const receipt = z.object({ id: z.uuid(), facility_id: z.uuid(), name: z.string(),
  key_prefix: z.string(), scopes: z.array(z.string()), is_active: z.boolean(),
  last_used_at: z.string().nullable(), expires_at: z.string().nullable(), created_at: z.string() });

export async function manageFacilityApiKey(input: {
  actorId: string; facilityId: string; keyId: string | null; action: 'create' | 'revoke'; values: Json;
}) {
  const label = 'admin-api-keys-' + input.action;
  let result;
  try {
    result = await createServiceRoleClient().rpc('manage_facility_api_key_atomic', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId, p_key_id: input.keyId,
      p_action: input.action, p_values: input.values,
    });
  } catch (error) { return serverError(label, databaseDiagnostic(error), '/api/admin/api-keys'); }
  if (result.error) {
    if (result.error.code === '42501') return NextResponse.json({ error: 'Unauthorized' }, { status: input.action === 'revoke' ? 404 : 403 });
    if (result.error.code === 'P0002') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result.error.code === '22023') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    if (result.error.code === '23505' || result.error.code === '40001') return NextResponse.json({ error: 'データが競合しました。再読み込みしてください' }, { status: 409 });
    return serverError(label, databaseDiagnostic(result.error), '/api/admin/api-keys');
  }
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.facility_id !== input.facilityId.toLowerCase()
    || (input.keyId !== null && parsed.data.id !== input.keyId.toLowerCase())
    || parsed.data.is_active !== (input.action === 'create')) {
    return serverError(label + '-receipt', new Error('API_KEY_RESULT_INVALID'), '/api/admin/api-keys');
  }
  const { facility_id: _facilityId, ...key } = parsed.data;
  return key;
}
