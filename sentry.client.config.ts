import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // パフォーマンストレースは低サンプリング（バンドル影響を最小化）
  tracesSampleRate: 0.02,
  // エラーは全件キャプチャ（ユーザー影響のある問題を取り逃さない）
  sampleRate: 1.0,
  environment: process.env.NODE_ENV,
  // Replayは無効（追加バンドルサイズを避ける）
  integrations: [],
  // 本番環境のみ有効化
  enabled: process.env.NODE_ENV === 'production',
  // ノイズとなる低重要度エラーを除外
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
    /^Loading chunk \d+ failed/,
    /^Loading CSS chunk \d+ failed/,
    'AbortError',
    'TypeError: Failed to fetch',
    'NetworkError',
  ],
  beforeSend(event) {
    // ブラウザ拡張機能によるエラーを除外
    const frames = event.exception?.values?.[0]?.stacktrace?.frames;
    if (frames?.some((f) => f.filename?.includes('extension://'))) return null;
    return event;
  },
});
