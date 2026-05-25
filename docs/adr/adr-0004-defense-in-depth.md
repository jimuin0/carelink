# ADR-0004: 8 層 Defense in Depth による予防的品質保証
Date: 2026-05-25
Status: Accepted

## Context
2026-05-24 に複数の連鎖インシデントが顕在化:

1. **Slack Webhook URL 漏洩** (commit `28aa5da`, 2026-04-20): テストファイル `src/app/api/notify/__tests__/route.test.ts:574` に実 URL が混入、Push Protection に拒否されるまで気付かれなかった
2. **38 日間デプロイ停止** (2026-04-16 〜 2026-05-24): Vercel Hobby cron 制約違反で全デプロイ拒否、誰も気付かなかった
3. **Upstash 喪失** (時期不明): Redis インスタンス削除で全 mutation API 500、in-memory フォールバックが try/catch されておらず連鎖死
4. **`/api/profile` 500 数日放置**: Sentry には記録されたが Slack 通知が無く可視化されず
5. **Google OAuth サインアップ名空欄**: handle_new_user trigger の不備
6. **既存 26 テストファイル 158 件失敗放置**: branch protection 未設定で main が永続 red

共通根本原因: **「予防レイヤがほぼ存在せず、全てが発症後対応に依存している」** という構造。

## Decision
8 視座統合報告（Claude 自身 + 7 サブエージェント）に基づき、Defense in Depth で 8 層の予防レイヤを段階導入する:

| Layer | 目的 | 実装 |
|---|---|---|
| 1 commit 段階 | 秘密混入の物理ブロック | husky + gitleaks pre-commit/pre-push, scripts/check-env-example.mjs |
| 2 PR 段階 | ビルド時拒否の事前検知 | .github/workflows/vercel-preview-build.yml |
| 3 マージガバナンス | main 直 push / 滞留防止 | CODEOWNERS, branch protection, PR template |
| 4 デプロイ監視 | 失敗放置 / ドリフト検知 | .github/workflows/deploy-watch.yml |
| 5 本番観測 | 即時通知 | instrumentation.ts, src/lib/alert.ts, /api/health multi-dep |
| 6 コード規約 | 同じバグを書けない構造 | src/lib/safe.ts, src/lib/with-route.ts, eslint-plugin-carelink-safety |
| 7 docs 永続化 | 知識の口頭伝承喪失防止 | docs/ops/, docs/runbooks/, docs/adr/ |
| 8 プロセス | 人間の死角を埋める | 月曜 10:00 JST 定例、月次 dependabot 棚卸し |

導入は 3 フェーズで段階的に実施:
- **Phase 1** (即日): Layer1 + Layer3 + Layer5 最小 (`/api/health` multi-dep)
- **Phase 1.5** (即日): 既存 26 テストファイル 158 件全修復 + Unit Tests を必須ゲートに復帰
- **Phase 2** (即日): Layer2 + Layer4 + Layer5 集約 + Contract test scaffold
- **Phase 3** (本 ADR): Layer6 + Layer7 + Layer8

## Consequences
良い点:
- 単一レイヤが破れても他レイヤが救う（多重防御）
- 過去 6 事象が全て検知 or 物理ブロック可能になる
- 新規開発者の onboarding が runbook + ADR で大幅改善

悪い点:
- ESLint custom plugin の有効化は既存 61 件の `Sentry.captureException` 直書きを `safeCaptureException` に移行してから（Phase 4）
- vercel-preview-build は `ENABLE_VERCEL_PR_BUILD=true` の vars 設定 + `VERCEL_TOKEN` secret が必要

残る課題（Phase 4 候補）:
- ESLint plugin 有効化 + 既存呼び出し点の `safeCaptureException` 移行
- 全 API ルートを `withRoute()` で書き換え
- SaaS インベントリの月次運用定着化
- UptimeRobot / Better Stack 設定（神原さん作業）

## Alternatives
1. **単一の魔法弾** (例: SRE プラクティス全部入りの 1 ツール導入): CareLink 規模では過剰、運用負荷大
2. **Phase なしの一括導入**: 既存テスト崩壊が同時に表面化し PR レビュー困難
3. **何もしない** (発症後対応継続): 連鎖インシデントが必ず再発する

## References
- ADR-0001: Vercel Hobby cron 制約
- ADR-0002: Upstash フォールバック
- ADR-0003: handle_new_user trigger
- Phase 1 PR: #6, Phase 1.5 PR: #7, Phase 2 PR: #8
- docs/runbooks/INDEX.md, docs/ops/SAAS-INVENTORY.md
- 8 視座統合報告は本セッションの会話履歴に残る（neither ADR nor docs に直接転記しない方針）
