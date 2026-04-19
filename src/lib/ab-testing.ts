/**
 * A/Bテスト基盤
 * feature_flags の rollout_pct を使ってバリアント割り当て
 * イベントをトラッキングして conversion rate を測定
 */

/**
 * ユーザーID（またはセッションID）からバリアントを決定する
 * 同じユーザーは常に同じバリアントを受け取る（決定的）
 * @param experimentKey feature_flagsのkey
 * @param userId ユーザーIDまたはセッションID
 * @param rolloutPct treatment に割り当てる割合(0-100)
 */
export function getVariant(experimentKey: string, userId: string, rolloutPct: number): 'control' | 'treatment' {
  if (rolloutPct <= 0) return 'control';
  if (rolloutPct >= 100) return 'treatment';

  // 文字列ハッシュ（決定的）
  const str = `${experimentKey}:${userId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // 32bit integer
  }
  const bucket = Math.abs(hash) % 100;
  return bucket < rolloutPct ? 'treatment' : 'control';
}

/**
 * クライアントサイドからA/Bテストイベントを送信
 */
export async function trackAbEvent(
  experimentKey: string,
  variant: 'control' | 'treatment',
  eventType: 'impression' | 'conversion' | 'click' | 'booking',
  options?: { userId?: string; sessionId?: string; pagePath?: string; metadata?: Record<string, unknown> }
) {
  if (typeof window === 'undefined') return;

  try {
    await fetch('/api/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experiment_key: experimentKey,
        variant,
        event_type: eventType,
        user_id: options?.userId,
        session_id: options?.sessionId ?? getSessionId(),
        page_path: options?.pagePath ?? window.location.pathname,
        metadata: options?.metadata ?? {},
      }),
    });
  } catch {
    // サイレント失敗（トラッキングエラーでUXを壊さない）
  }
}

/** セッションIDを localStorage から取得または生成 */
function getSessionId(): string {
  try {
    let sid = localStorage.getItem('_carelink_sid');
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem('_carelink_sid', sid);
    }
    return sid;
  } catch {
    return 'unknown';
  }
}
