# SaaS Inventory（CareLink 依存 SaaS 台帳）

> 毎月1日見直し / 担当: <氏名未設定> / 最終更新: 2026-05-25

CareLink が依存する全 SaaS の live 管理台帳。`.env.example` および `package.json` から事実根拠を確認した依存のみ記載する。新規 SaaS 追加時は必ず本ファイルに追記すること。値（キー・URL・トークン）は本ファイルに記載禁止。

## 台帳

| サービス | 用途 | 管理URL | 契約者メール | プラン | 更新日 | ローテーション頻度 | 喪失時影響 |
|---------|------|---------|--------------|--------|--------|------------------|-----------|
| Vercel | ホスティング / デプロイ / Cron | https://vercel.com/dashboard | <未記入> | Hobby（要確認） | <未記入> | アカウント認証は年1 / トークンは半年 | 全サービス停止 |
| Supabase | DB / Auth / Storage / SSR | https://supabase.com/dashboard | <未記入> | <未記入> | <未記入> | service_role キーは半年 | 全データ・認証停止 |
| Upstash Redis | レートリミット（@upstash/ratelimit） | https://console.upstash.com | <未記入> | <未記入> | <未記入> | REST_TOKEN 半年 | in-memory フォールバック動作（プロセス再起動でリセット） |
| Stripe | 決済（stripe / @stripe/stripe-js） | https://dashboard.stripe.com | <未記入> | <未記入> | <未記入> | secret key 年1 / Webhook secret 変更時即時 | 決済停止 |
| Resend | メール送信（resend SDK） | https://resend.com/overview | <未記入> | Free 想定（要確認） | <未記入> | API key 半年 | メール通知停止 |
| Anthropic | LLM（@anthropic-ai/sdk） | https://console.anthropic.com | <未記入> | <未記入> | <未記入> | API key 半年 | AI 機能停止 |
| LINE (Messaging / OAuth / LIFF) | ログイン・通知・LIFF（@line/liff） | https://developers.line.biz/console | <未記入> | Messaging API Free 想定 | <未記入> | Channel secret 年1 / access token 半年 | LINE ログイン・通知停止 |
| Google (Maps / Places API) | GBP 連携・地図・口コミ（GOOGLE_MAPS_API_KEY） | https://console.cloud.google.com | <未記入> | 従量課金 | <未記入> | API key 半年 / billing alert 月次 | 地図・口コミ・スコア計算停止 |
| Sentry | エラー監視（@sentry/nextjs） | https://sentry.io | <未記入> | <未記入> | <未記入> | DSN 変更時のみ / Auth token 半年 | エラー検知不可（サービスは継続） |
| Slack | 障害通知 Webhook（SLACK_WEBHOOK_URL） | https://api.slack.com/apps | <未記入> | Free | <未記入> | Webhook URL 年1 | 通知停止（500 応答化） |
| Web Push (VAPID 自管理) | Push 通知（web-push パッケージ） | 自管理（VAPID keypair） | <未記入> | n/a | <未記入> | 原則ローテ不可（変更すると全購読が無効化） | Push 停止・全購読再取得が必要 |
| GitHub Actions | CI / cron 代替（Vercel Hobby cron 制約回避） | https://github.com/<org>/carelink/actions | <未記入> | Free 想定 | <未記入> | PAT 半年 | CI / 定期ジョブ停止 |
| reCAPTCHA | bot 防御（要確認: 環境変数未掲載のため利用箇所要確認） | https://www.google.com/recaptcha/admin | <未記入> | v3 想定 | <未記入> | site/secret key 年1 | bot 防御低下 |

## 削除・変更ログ（追記式・消すな）

新規追加・解約・プラン変更・契約者変更は時系列で追記する。**過去エントリは絶対に削除しない**。

書き込み雛形:

```
- YYYY-MM-DD <担当氏名> [追加 | 変更 | 解約] <サービス名>
  - 変更内容: <旧 → 新>
  - 理由: <なぜ変えたか>
  - 影響範囲: <何が変わるか>
  - ロールバック手順: <戻し方>
```

例:

```
- 2026-05-25 神原良祐 [追加] SaaS Inventory 初版作成
  - 変更内容: 新規ファイル作成
  - 理由: Phase 3 ドキュメント整備
  - 影響範囲: ドキュメントのみ
  - ロールバック手順: 本ファイル削除
```
