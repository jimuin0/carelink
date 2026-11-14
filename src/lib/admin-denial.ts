import { NextResponse } from 'next/server';

/**
 * 管理 API の拒否応答の単一ソース（点検 A205・2026年11月14日 本人決定）。
 *
 * - 未ログイン（セッションが無い）だけが 401「ログインしてください」。
 * - ログイン済みで権限が無い（店舗の所属を外された・運営権限を取り消された・他店舗のデータ）は
 *   403「権限がありません」。以前は画面によって 401 を返し、権限を外された人に
 *   「再ログインして」と読める応答になっていた（再ログインしても直らない）。
 */
export const ADMIN_UNAUTHENTICATED_MESSAGE = 'ログインしてください';
export const ADMIN_FORBIDDEN_MESSAGE = '権限がありません';

type DenialInit = { headers?: HeadersInit; body?: Record<string, unknown> };

export function adminUnauthenticated(init: DenialInit = {}): NextResponse {
  return NextResponse.json({ error: ADMIN_UNAUTHENTICATED_MESSAGE, ...init.body }, { status: 401, headers: init.headers });
}

export function adminForbidden(init: DenialInit = {}): NextResponse {
  return NextResponse.json({ error: ADMIN_FORBIDDEN_MESSAGE, ...init.body }, { status: 403, headers: init.headers });
}
