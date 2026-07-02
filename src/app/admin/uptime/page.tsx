import type { Metadata } from 'next';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

export const metadata: Metadata = { title: 'Uptime監視 | 管理画面 | CareLink' };

const MONITORS = [
  { name: 'メインサイト', url: 'https://carelink-jp.com', description: 'トップページ' },
  { name: 'ヘルスチェック', url: 'https://carelink-jp.com/api/health', description: 'DB接続確認' },
  { name: '検索API', url: 'https://carelink-jp.com/search', description: '施設検索ページ' },
  { name: '予約API', url: 'https://carelink-jp.com/api/booking', description: '予約エンドポイント' },
];

export default async function UptimePage() {
  // Fetch health status from our own health endpoint
  let healthData: { status: string; db: string; elapsed_ms: number; timestamp: string; version?: string } | null = null;
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://carelink-jp.com';
    const res = await fetch(`${base}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) healthData = await res.json();
  } catch {
    // Health check unavailable in SSR context
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <SbPageHeader title="Uptime 監視設定" description="外部監視サービスの設定ガイドと現在のヘルス状態" />

      {/* Current health */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-bold text-gray-800 mb-4">現在のシステム状態</h2>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${healthData?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
          <span className="font-medium text-sm">
            {healthData?.status === 'healthy' ? '正常稼働中' : healthData ? 'エラーあり' : '確認中...'}
          </span>
          {healthData?.elapsed_ms && (
            <span className="text-xs text-gray-400">DB応答: {healthData.elapsed_ms}ms</span>
          )}
          {healthData?.version && (
            <span className="text-xs text-gray-400">v{healthData.version}</span>
          )}
        </div>
        {healthData?.timestamp && (
          <p className="text-xs text-gray-400 mt-2">
            最終確認: {new Date(healthData.timestamp).toLocaleString('ja-JP')}
          </p>
        )}
      </div>

      {/* Monitor endpoints */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">監視エンドポイント一覧</h2>
        <p className="text-xs text-gray-500">以下のURLを外部監視サービス（UptimeRobot等）に登録してください。</p>
        <div className="space-y-2">
          {MONITORS.map((m) => (
            <div key={m.url} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-800">{m.name}</p>
                <p className="text-xs text-gray-500">{m.description}</p>
              </div>
              <code className="text-xs text-gray-600 bg-white border border-gray-200 px-2 py-1 rounded font-mono truncate max-w-[200px]">
                {m.url}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Setup guide */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-bold text-gray-800">外部監視サービスの設定手順</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">1. UptimeRobot（無料プランあり）</h3>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>UptimeRobot.com でアカウント作成（無料プランで5分間隔監視が可能）</li>
              <li>「Add New Monitor」→ Monitor Type: HTTP(s)</li>
              <li>Friendly Name: CareLink ヘルスチェック</li>
              <li>URL: https://carelink-jp.com/api/health</li>
              <li>Monitoring Interval: 5 minutes</li>
              <li>アラート先にメール・Slackを登録</li>
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">2. Vercel Cron（内部監視）</h3>
            <p className="text-xs text-gray-600 mb-2">
              本システムは既に <code className="bg-gray-100 px-1 rounded text-xs">/api/health</code> エンドポイントを提供しています。
              Vercelの「Monitoring」タブからも確認可能です。
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">3. Slack アラート（内蔵・Sentry は廃止済み）</h3>
            <p className="text-xs text-gray-600 mb-2">
              API ルートの 500 級例外は <code className="bg-gray-100 px-1 rounded text-xs">instrumentation.ts</code> の
              onRequestError 経由で自動的に Slack へ通知されます（<code className="bg-gray-100 px-1 rounded text-xs">SLACK_BOT_TOKEN</code> と
              <code className="bg-gray-100 px-1 rounded text-xs">SLACK_DEFAULT_CHANNEL</code> が必要）。外部の Sentry 連携は不要です。
            </p>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>Vercel 環境変数に SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL を設定</li>
              <li>疎通テスト：<code className="bg-gray-100 px-1 rounded text-xs">/api/alert-check?fire=1&amp;token=&lt;ALERT_CHECK_TOKEN&gt;</code> を開く</li>
              <li>Slack の通知チャンネルにテスト通知が届けば疎通OK</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Status page */}
      <div className="bg-sky-50 rounded-xl p-5 text-sm text-sky-800">
        <p className="font-bold mb-1">パブリックステータスページの設定</p>
        <p className="text-xs">
          UptimeRobot の「Public Status Pages」機能を使って、
          ユーザー向けのステータスページ（例: status.carelink-jp.com）を設置できます。
          障害時の透明性確保に効果的です。
        </p>
        <Link href="https://uptimerobot.com" target="_blank" rel="noopener noreferrer"
          className="inline-block mt-2 text-xs text-sky-600 hover:underline">
          UptimeRobot を開く →
        </Link>
      </div>
    </div>
  );
}
