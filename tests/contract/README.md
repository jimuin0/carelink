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
- `schema-invariants.contract.test.ts`: スキーマ/RLS ドリフトの恒久ガード
  （RPC 存在・予約 RPC の 0A000 landmine 検知・anon の過大公開防止・
  google 列 / View / flagging 列の存在）。`STAGING_SUPABASE_SERVICE_ROLE_KEY`
  があれば service_role 限定オブジェクトも確定検証。

## CI（GitHub Actions）

`.github/workflows/ci.yml` の `contract-test` ジョブが push / PR で本フォルダを
`npm run test:contract` で実行する。staging 専用 secrets が未設定なら全テストが
skip され（本番には一切触れない）、secrets を設定した時点でドリフト検知ゲートとして
自動的に有効化される。secrets 未設定時はジョブ summary に「ゲート無効」警告を出して
false-green を防ぐ。

### 必要な GitHub Secrets（**キー名のみ・値は repo に書かない**）

| Secret 名 | 必須 | 用途 |
|-----------|------|------|
| `STAGING_SUPABASE_URL` | 必須 | staging Supabase の REST/Auth エンドポイント |
| `STAGING_SUPABASE_ANON_KEY` | 必須 | anon 権限の RLS 不変条件検証 |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | 任意 | service_role 限定のカラム/View/テーブル存在の確定検証 |
| `UPSTASH_REDIS_REST_URL` | 任意 | Upstash 疎通（Phase 6 で Postgres rate-limit に移行済みのため任意） |
| `UPSTASH_REDIS_REST_TOKEN` | 任意 | 同上 |

設定方法: GitHub リポジトリ → Settings → Secrets and variables → Actions →
New repository secret。**必ず staging（本番と分離した）プロジェクトの値**を入れること。
本番の URL / key を入れると CI が本番に到達してしまうため厳禁。

## いつ追加するか
新規外部 SaaS を `src/lib/integrations/` に追加した時、必ず本フォルダに対応する
contract テストを追加する。Phase 3 で `src/lib/integrations/` 抽象化と同時に
カバレッジを上げる。

## 注意
- 本番リソースには絶対に触らない（staging 専用 env vars のみ参照）
- 1テストあたり 5秒以内のタイムアウト（外部依存の遅延が CI を詰まらせない）
- CI で flaky な場合は `retries: 2` を許可するが、根本原因（接続不安定）の
  調査を runbook に記録する
