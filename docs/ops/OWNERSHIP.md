# OWNERSHIP - 役割定義と当番ローテ

CareLink 運用における役割と当番。`.github/CODEOWNERS` の責任範囲と整合させる。
担当者欄が `<未記入>` のものは初回ローテ確定時に埋める。

---

## 役割定義

### 1. デプロイ監視担当

- **責務**:
  - Vercel デプロイの成否を確認する
  - 失敗時は原因を特定し、修正 PR を起票するか担当者に振る
  - 本番 URL（https://carelink-jp.com 想定）のヘルスチェック
- **権限**: Vercel ダッシュボード閲覧、GitHub Actions 再実行
- **担当**: <未記入>
- **エスカレーション先**: インシデント司令塔

### 2. SaaS 契約管理

- **責務**:
  - `docs/ops/SAAS-INVENTORY.md` の維持（毎月1日更新）
  - 契約者メール・プラン・支払い手段の最新化
  - キーローテーション計画と実施
  - 解約・プラン変更時の ADR 起票
- **権限**: 各 SaaS 管理画面の Owner / Admin
- **担当**: <未記入>
- **エスカレーション先**: インシデント司令塔

### 3. インシデント司令塔

- **責務**:
  - 障害発生時の指揮統制（Slack #incident 起票・タイムライン記録）
  - ポストモーテム執筆と再発防止策の落とし込み
  - 関係 SaaS への問い合わせ起票判断
- **権限**: 全 SaaS への緊急アクセス、本番ロールバック判断
- **担当**: <未記入>
- **副担当**: <未記入>（司令塔不在時の代理）

### 4. 当番（週次ローテ）

- **責務**:
  - 上記 1〜3 の日常業務を week-on-call として一次対応する
- **ローテ単位**: 週次
- **定例**: 毎週月曜 10:00 JST
- **引き継ぎ場所**: Slack #carelink-ops
- **ローテメンバー**: <氏名1> / <氏名2> / <氏名3>（要記入）

---

## 当番義務（必須実施事項）

### 毎週月曜 10:00 JST 定例

以下を **必ず実施**。実施漏れは「38日放置事象」のような構造的事故を再発させる。

1. **Vercel デプロイ状態確認**
   - 直近 1 週間のデプロイ履歴を Vercel ダッシュボードで確認
   - 失敗デプロイがあれば原因を特定 → Slack #carelink-ops に共有
   - **38日放置事象（Phase 0/1 で発覚）の構造的再発防止のため絶対省略しない**
2. **GitHub Actions cron 実行確認**
   - `.github/workflows/` 配下の cron が想定通り実行されたか確認
   - 失敗があれば再実行 or 修正 issue 起票
3. **Sentry / Slack 通知の未対応分確認**
   - Sentry の未解決 issue を triage
   - Slack 通知への未返信を回収
4. **SaaS Inventory の差分確認（月初の月曜のみ）**
   - 新規 SaaS 追加が `docs/ops/SAAS-INVENTORY.md` に反映されているか
   - 解約予定の SaaS がないか

---

## CODEOWNERS との整合

`.github/CODEOWNERS` では以下が `@jimuin0` 単独所有となっている（2026-05-25 時点）:

- 全体デフォルト
- `/supabase/migrations/`, `/.github/`, `/middleware.ts`, `/vercel.json`, `/package.json`, `/package-lock.json`, `/.env.example`
- `/src/app/api/` の `auth/`, `payment/`, `admin/`, `cron/`, `profile/`, `account/`
- `/src/lib/` の `csrf.ts`, `cron-auth.ts`, `rate-limit.ts`, `supabase-server.ts`, `supabase-server-auth.ts`, `audit-logger.ts`

これらは **SaaS 契約管理 + インシデント司令塔** の責務領域と一致する。`@jimuin0` 不在時の代理レビュアーを CODEOWNERS に追加する場合は、本ファイルの副担当欄と必ず同期させる。

---

## 変更履歴

- 2026-05-25 初版作成（Phase 3 ドキュメント整備）
