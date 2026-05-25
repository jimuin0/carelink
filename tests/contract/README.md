# Contract Tests（Phase 2）

実 SaaS 依存（Supabase staging / Upstash / Stripe / Resend）への到達性テスト。
Jest unit テストが mock 漏れで偽陽性 green を吐いていた問題への防御層。

## 実行
```bash
npm run test:contract
```

`STAGING_*` env vars が設定された環境（CI の contract job / 開発者ローカル）でのみ実行される。
未設定時は全テスト skip。

## 含まれるテスト
- `supabase-contract.test.ts`: 実 Supabase staging への REST 到達性
- `upstash-contract.test.ts`: 実 Upstash Redis への ping

## いつ追加するか
新規外部 SaaS を `src/lib/integrations/` に追加した時、必ず本フォルダに対応する
contract テストを追加する。Phase 3 で `src/lib/integrations/` 抽象化と同時に
カバレッジを上げる。

## 注意
- 本番リソースには絶対に触らない（staging 専用 env vars のみ参照）
- 1テストあたり 5秒以内のタイムアウト（外部依存の遅延が CI を詰まらせない）
- CI で flaky な場合は `retries: 2` を許可するが、根本原因（接続不安定）の
  調査を runbook に記録する
