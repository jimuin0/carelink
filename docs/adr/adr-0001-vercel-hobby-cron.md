# ADR-0001: Vercel Hobby cron 制約 → GitHub Actions 移行
Date: 2026-05-24
Status: Accepted

## Context（何が問題か）
過去 38日間、Vercel 本番デプロイが全て失敗していた。原因は `vercel.json` に hourly (`0 * * * *`) や 15分毎 (`*/15 * * * *`) の cron が含まれており、Vercel Hobby プランの「cron は 1日 1回まで」「合計 2 件まで」制約に違反していたため。エラーコード: `cron_jobs_limits_reached`。

該当 cron（3件）:
- `/api/cron/flag-reviews` (0 * * * *)
- `/api/cron/waitlist-notify` (0 * * * *)
- `/api/cron/webhook-retry` (*/15 * * * *)

加えて daily/weekly/monthly の 9 件と合わせて 計 12 件あり、件数制約も超過していた。

## Decision（何を決めたか）
全 cron を `vercel.json` から削除し `.github/workflows/cron.yml` の GitHub Actions schedule に移行する。Bearer 認証 (`CRON_SECRET`) で各 `/api/cron/*` を GET 叩く方式。

## Consequences
良い点:
- 無料、頻度自由（GitHub Actions は per-minute まで設定可能）
- ベンダーロックイン低減（Vercel Cron 依存削除）
- 実行ログが GitHub Actions タブに残り追跡しやすい

悪い点:
- GitHub Actions の cron は best-effort（数分の遅延あり）
- Public repo の場合、attack surface が増える（CRON_SECRET 保護必須）

残る課題:
- GitHub Actions の遅延が業務影響する場合は Vercel Pro 課金 ($20/月) を再検討
- 月次の SaaS インベントリで Vercel プラン変更があった際は ADR 更新

## Alternatives
1. **Vercel Pro 課金** ($20/月): 全 cron 維持可能だが固定費発生。
2. **daily 化** (cron 頻度を 1日 1回に変更): hourly/15分毎の機能（waitlist-notify 等）の UX が劣化するため不採用。
3. **Supabase pg_cron**: DB 層で cron 定義可能だが API 認証 + 外部 fetch 連携で複雑化、別 SaaS ロックイン。

## References
- Phase 0 修正: 本セッション内で実装
- `.github/workflows/cron.yml` (`d2a2441`)
- `vercel.json` (crons セクション削除済)
- runbook: `docs/runbooks/deploy-failure.md`
