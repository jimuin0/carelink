/**
 * admin-dashboard heartbeat 送信（best-effort）。
 *
 * cron の成功/失敗/スキップを admin-dashboard の POST /api/heartbeat に job_id 付きで
 * 通知し、「Render Cron 16本が予定時刻に走らなかった沈黙」をダッシュボードで能動検知する。
 * admin 側は job_id 単位で task と突合するため、ここで送る job_id は各 route の cron 名
 * （logCronRun の jobName）と一致させる。
 *
 * 設計（karusaku-emr の admin-heartbeat.js と同型・リトライ仕様も踏襲）:
 *   - env (ADMIN_HEARTBEAT_URL / ADMIN_HEARTBEAT_TOKEN) 未設定なら no-op（開発/テストは無音）。
 *   - fire-and-forget。例外は内部で握り潰し、呼び出し元（logCronRun 等の cron 本体）に
 *     一切影響させない（reject しない・本体処理をブロックしない）。
 *   - transient な送信失敗（一時ネット断・admin 一時不調・非2xx）は最大 MAX_ATTEMPTS まで
 *     再試行する。これが無いと cron は成功したのに heartbeat だけ届かず admin が missing
 *     (沈黙) と誤検知し得るため。
 */

const PROJECT_ID = 'carelink';
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export type HeartbeatStatus = 'ok' | 'degraded' | 'fail';

// テスト容易化のため sleep を差し替え可能にする（本番は setTimeout。再試行の遅延は
// fire-and-forget の promise 内なので cron をブロックしない）。
export const _internal = {
  /* istanbul ignore next: 本番用デフォルト実装。テストは常に _internal.sleep を差し替えて呼ぶため到達しない。 */
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * @param jobId  cron ジョブ名（logCronRun の jobName と一致させる。例: 'booking-reminder'）
 * @param status 'ok' | 'degraded' | 'fail'
 * @returns 常に解決（reject しない）。
 */
export function pushAdminHeartbeat(jobId: string, status: HeartbeatStatus): Promise<void> {
  try {
    const url = (process.env.ADMIN_HEARTBEAT_URL || '').trim();
    const token = (process.env.ADMIN_HEARTBEAT_TOKEN || '').trim();
    if (!url || !token || !jobId) return Promise.resolve();
    if (typeof fetch !== 'function') return Promise.resolve();

    const body = JSON.stringify({ project_id: PROJECT_ID, job_id: jobId, status });

    const attempt = (n: number): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(
        /* istanbul ignore next: 5s タイムアウト到達時のみ実行される abort コールバック（テスト不能） */
        () => controller.abort(),
        TIMEOUT_MS,
      );
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      })
        .then((r) => {
          if (r.ok) return undefined;
          if (n < MAX_ATTEMPTS) {
            return _internal.sleep(RETRY_DELAY_MS).then(() => attempt(n + 1));
          }
          console.error('[admin-heartbeat] 送信失敗(リトライ上限)', {
            job_id: jobId,
            status,
            http_status: r.status,
            attempts: n,
          });
          return undefined;
        })
        .catch((e: unknown) => {
          if (n < MAX_ATTEMPTS) {
            return _internal.sleep(RETRY_DELAY_MS).then(() => attempt(n + 1));
          }
          console.error('[admin-heartbeat] 送信失敗(リトライ上限)', {
            job_id: jobId,
            status,
            error: e instanceof Error ? e.message : String(e),
            attempts: n,
          });
          return undefined;
        })
        .finally(() => clearTimeout(timer));
    };

    return attempt(1);
  } catch (e) {
    console.error('[admin-heartbeat] 送信スキップ（内部例外）', {
      job_id: jobId,
      error: e instanceof Error ? e.message : String(e),
    });
    return Promise.resolve();
  }
}
