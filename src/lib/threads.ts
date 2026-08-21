/**
 * Threads（https://www.threads.net/）投稿クライアント【SSOT】
 *
 * 記事公開を自動で Threads へ投稿するための最小基盤。契約（シグネチャ）は固定で、
 * 他エージェントが並行してこれに依存する実装を書いているため変更しない。
 *
 * 実仕様（公式ドキュメント準拠）:
 *   - ベース: https://graph.threads.net/v1.0
 *   - 投稿は2段階: (1) POST /{threads-user-id}/threads で media_type=TEXT・text・
 *     access_token を渡してコンテナを作成 → 戻り値の id を creation_id として
 *     (2) POST /{threads-user-id}/threads_publish で公開する
 *   - テキストは 500 文字上限
 *   - 24時間あたり 250 投稿まで（本モジュールではレート制御はしない。呼び出し頻度が
 *     十分低い前提。将来必要になれば呼び出し側でスロットリングする）
 *   - 長期トークンは 60日で失効。更新は
 *     GET /refresh_access_token?grant_type=th_refresh_token&access_token=<TOKEN>。
 *     24時間以上経過かつ未失効のときだけ更新でき、60日を過ぎると二度と更新できない
 *     （手動再認可が必要）
 *
 * 🔴 process.env の直読みはこのファイルの中だけに閉じる。
 */

import { createServiceRoleClient } from '@/lib/supabase-server';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

/** Threads の投稿本文の上限文字数（公式ドキュメント準拠）。 */
const THREADS_MAX_CHARS = 500;

/** 記事タイトルと URL の間に挟む区切り。 */
const SEPARATOR = '\n\n';

/** タイトルを切り詰めたことを示す省略記号（全角1文字扱い・.length は 1）。 */
const ELLIPSIS = '…';

/** fetch のタイムアウト（Threads API 呼び出し1回あたり）。 */
const FETCH_TIMEOUT_MS = 10000;

export type ThreadsOutcome = 'published' | 'skipped' | 'transient' | 'permanent';

export interface ThreadsPublishResult {
  outcome: ThreadsOutcome;
  postId?: string;
  reason?: string;
}

/**
 * `THREADS_USER_ID` を取得する。未設定・空文字は null（未設定として扱う）。
 * process.env の直読みはこの関数と refreshThreadsToken の中だけに限定する。
 */
function getThreadsUserId(): string | null {
  const id = process.env.THREADS_USER_ID;
  return id && id.trim() !== '' ? id : null;
}

/**
 * threads_credentials（単一行運用）からアクセストークンを取得する。
 * 行が無い・エラーの場合は null（＝未設定として扱う。エラーにはしない）。
 */
async function getStoredCredential(): Promise<{
  id: string;
  accessToken: string;
  expiresAt: string;
} | null> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('threads_credentials')
      .select('id, access_token, expires_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { id: data.id, accessToken: data.access_token, expiresAt: data.expires_at };
  } catch {
    // service role client 生成失敗（env 未設定）等も未設定として扱う。
    return null;
  }
}

/** HTTP ステータスから恒久/一時エラーを判定する（src/lib/line.ts の区別と同じ思想）。 */
function outcomeFromStatus(status: number): 'transient' | 'permanent' {
  // 429（レート制限）と 5xx（Threads 側の一時障害）はリトライする価値がある。
  // それ以外の 4xx（トークン失効・権限不足・不正なパラメータ等）は再試行しても解決しない。
  if (status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${THREADS_API_BASE}${path}?${qs}`;
}

/**
 * 本文を Threads へ投稿する。
 *
 * 未設定（THREADS_USER_ID が無い、または threads_credentials が空）は 'skipped' を返す
 * （エラーにも通知にもしない＝未設定は誤設定ではない）。
 */
export async function publishThreadsText(text: string): Promise<ThreadsPublishResult> {
  const userId = getThreadsUserId();
  if (!userId) {
    return { outcome: 'skipped', reason: 'THREADS_USER_ID is not configured' };
  }

  const credential = await getStoredCredential();
  if (!credential) {
    return { outcome: 'skipped', reason: 'threads_credentials has no row' };
  }

  // ── 1. コンテナ作成 ──────────────────────────────────────────────────
  let creationId: string;
  try {
    const res = await fetch(
      buildUrl(`/${userId}/threads`, {
        media_type: 'TEXT',
        text,
        access_token: credential.accessToken,
      }),
      { method: 'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        outcome: outcomeFromStatus(res.status),
        reason: `container creation failed: ${res.status} ${body}`,
      };
    }

    const json = (await res.json()) as { id?: string };
    if (!json.id) {
      return { outcome: 'permanent', reason: 'container creation: response has no id' };
    }
    creationId = json.id;
  } catch (e) {
    return { outcome: 'transient', reason: `container creation error: ${String(e)}` };
  }

  // ── 2. 公開 ──────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      buildUrl(`/${userId}/threads_publish`, {
        creation_id: creationId,
        access_token: credential.accessToken,
      }),
      { method: 'POST', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        outcome: outcomeFromStatus(res.status),
        reason: `publish failed: ${res.status} ${body}`,
      };
    }

    const json = (await res.json()) as { id?: string };
    if (!json.id) {
      return { outcome: 'permanent', reason: 'publish: response has no id' };
    }
    return { outcome: 'published', postId: json.id };
  } catch (e) {
    return { outcome: 'transient', reason: `publish error: ${String(e)}` };
  }
}

/**
 * DB(threads_credentials) のトークンを更新する。cron が呼ぶ。
 *
 * Threads の長期トークンは 24時間以上経過かつ未失効のときだけ更新でき、
 * 60日を過ぎると二度と更新できない（手動再認可が必要）。60日を過ぎている場合は
 * 無駄なネットワーク呼び出しをせず、その旨を reason に返す。
 */
export async function refreshThreadsToken(): Promise<{
  ok: boolean;
  expiresAt?: string;
  reason?: string;
}> {
  const credential = await getStoredCredential();
  if (!credential) {
    return { ok: false, reason: 'threads_credentials has no row' };
  }

  const expiresAtMs = Date.parse(credential.expiresAt);
  if (!Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now()) {
    // 60日を過ぎると API 側が更新を拒否する。呼んでも無駄なので呼ばない。
    return { ok: false, reason: 'token already expired; manual re-authorization required' };
  }

  try {
    const res = await fetch(
      buildUrl('/refresh_access_token', {
        grant_type: 'th_refresh_token',
        access_token: credential.accessToken,
      }),
      { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `refresh failed: ${res.status} ${body}` };
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token || typeof json.expires_in !== 'number') {
      return { ok: false, reason: 'refresh: response missing access_token/expires_in' };
    }

    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + json.expires_in * 1000).toISOString();

    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from('threads_credentials')
      .update({
        access_token: json.access_token,
        expires_at: newExpiresAt,
        refreshed_at: now.toISOString(),
      })
      .eq('id', credential.id);

    if (error) {
      return { ok: false, reason: `db update failed: ${error.message}` };
    }

    return { ok: true, expiresAt: newExpiresAt };
  } catch (e) {
    return { ok: false, reason: `refresh error: ${String(e)}` };
  }
}

/**
 * 1 コードポイントが Threads の上限に対して消費する「重み」。
 *
 * 🔴 Threads の公式ドキュメントは上限を「500 characters」としつつ、
 *   **"emojis count as UTF-8 bytes, potentially consuming multiple characters"**
 *   と明記している。つまり絵文字だけはバイト単位で課金される。
 *
 *   - BMP 内（日本語のかな・カナ・漢字を含む）… 1 として数える。
 *     ここでバイト数を使うと日本語1文字＝3バイトとなり、実際には入るものを
 *     3分の1しか入れられなくなる（過剰な切り詰め）。
 *   - BMP 外（絵文字・U+10000 以上）… UTF-8 バイト数（通常 4）で数える。
 *     ここで `.length`（UTF-16 コード単位＝2）を使うと **過小評価**になり、
 *     絵文字を多く含むタイトルで 500 を超えて送信し得る。
 */
function threadsWeightOfCodePoint(codePoint: number): number {
  return codePoint > 0xffff
    ? Buffer.byteLength(String.fromCodePoint(codePoint), 'utf8')
    : 1;
}

/** 文字列全体の重み（上記の合計）。 */
function threadsWeight(text: string): number {
  let total = 0;
  for (const ch of text) total += threadsWeightOfCodePoint(ch.codePointAt(0) as number);
  return total;
}

/**
 * 重みが budget を超えない最大の接頭辞を返す。
 *
 * 🔴 `String.prototype.slice` を使わないのは、**サロゲートペアを分断して文字化けを
 *   公開投稿に出してしまう**ため。実測: `'記事タイトル😀です'.slice(0, 7)` は
 *   `'記事タイトル\ud83d'`（孤立サロゲート）を返す。
 *   `for...of` は文字列をコードポイント単位で回すので、この分断が原理的に起きない。
 */
function truncateToThreadsWeight(text: string, budget: number): string {
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = threadsWeightOfCodePoint(ch.codePointAt(0) as number);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  return out;
}

/**
 * 記事タイトルと URL から、500文字上限に収まる投稿本文を組み立てる（純粋関数）。
 *
 * URL は必ず残す（切れたら投稿の意味が無い）。上限を超える分はタイトル側だけを
 * 切り詰め、省略記号を付ける。文字数の数え方は上の `threadsWeightOfCodePoint` を参照。
 */
export function buildArticlePostText(title: string, url: string): string {
  const budgetForTitleAndSeparator = THREADS_MAX_CHARS - threadsWeight(url);

  if (budgetForTitleAndSeparator <= 0) {
    // URL 単体だけで上限に迫る／超える極端なケース。URL は削らない方針なので
    // タイトルと区切りを諦めて URL だけを返す（投稿の意味を保つのは常に URL 側）。
    return url;
  }

  const budgetForTitle = budgetForTitleAndSeparator - threadsWeight(SEPARATOR);

  if (budgetForTitle <= 0) {
    // タイトルを入れる余地が無い（URL + 区切りだけで上限ぎりぎり）。URL のみ返す。
    return url;
  }

  if (threadsWeight(title) <= budgetForTitle) {
    return `${title}${SEPARATOR}${url}`;
  }

  const truncatedTitle = `${truncateToThreadsWeight(
    title,
    Math.max(0, budgetForTitle - threadsWeight(ELLIPSIS))
  )}${ELLIPSIS}`;
  return `${truncatedTitle}${SEPARATOR}${url}`;
}
