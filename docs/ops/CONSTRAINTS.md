# CONSTRAINTS - 絶対忘れるなリスト

CareLink 運用において **構造的に踏みやすい地雷** を集約する。事実根拠が確認できたもののみ記載する。
**各項目とも変更時は ADR（Architecture Decision Record）必須。** 口頭・チャットでの合意のみで変えない。

---

## 1. Vercel Hobby Cron 制約

- **事実**: Vercel Hobby プランの cron は 1日1回上限。Phase 0/1 で発覚し GitHub Actions に移行済（commit `d2a2441`）。
- **影響**: Vercel cron に新規ジョブを追加すると即座に上限超過する。
- **遵守事項**: 定期ジョブは GitHub Actions（`.github/workflows/`）に追加する。Vercel cron は追加禁止。
- **変更時は ADR 必須**（プラン昇格時も含む）。

## 2. Supabase service_role キーはサーバー専用

- **事実**: `SUPABASE_SERVICE_ROLE_KEY` は RLS をバイパスする全権キー。
- **遵守事項**: Edge Runtime / Client Component / `NEXT_PUBLIC_*` への露出禁止。Node runtime の Server Component / API Route / `src/lib/supabase-server.ts` でのみ使用。
- **変更時は ADR 必須**（キーローテーションは ADR 不要だが、利用箇所追加は ADR 必須）。

## 3. Upstash 未設定時は in-memory rate-limit フォールバック

- **事実**: Phase 0 で `src/lib/rate-limit.ts` に in-memory フォールバック実装済（commit `5ebfe30`）。`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` が空または Upstash 障害時に in-memory モードで動作。
- **影響**: in-memory はプロセス再起動でリセット・複数インスタンス間で共有されない。本番では Upstash 必須。
- **遵守事項**: 本番環境変数で Upstash 未設定検知時は Sentry/Slack に警告する運用とする。
- **変更時は ADR 必須**。

## 4. LINE Messaging API レート制限

- **事実**: LINE Messaging API は短期上限 300 通/分・push 系は月次クォータあり（プラン依存）。
- **遵守事項**: 通知バーストを発生させる新機能追加時は事前にスループット試算する。
- **変更時は ADR 必須**。

## 5. Resend 送信制限

- **事実**: Resend Free プランは 1日100通 / 月3000通。
- **遵守事項**: 送信総数を Sentry/Slack で日次監視する。プラン変更時はキー再発行不要だがダッシュボード確認必須。
- **変更時は ADR 必須**。

## 6. Stripe Webhook 署名検証必須

- **事実**: 既存実装あり。Webhook secret なしのエンドポイントは即座に攻撃対象になる。
- **遵守事項**: `/api/payment/webhook` 系は `stripe.webhooks.constructEvent` による署名検証を絶対に省略しない。新規 Webhook 追加時も同じパターンを踏襲。
- **変更時は ADR 必須**。

## 7. Next.js 15 で `cookies()` は async

- **事実**: Next.js 15.5.x（本プロジェクトは `next@15.5.15`）では `cookies()` / `headers()` が Promise を返す。
- **遵守事項**: `const cookieStore = await cookies()` のように **必ず `await`**。`.get()` を同期呼びすると型エラー・ランタイムで undefined になる。
- **変更時は ADR 必須**（Next.js メジャー更新時）。

## 8. `.env.example` への実値混入禁止

- **事実**: Phase 1 で pre-commit hook（gitleaks lint-staged 設定済 / `package.json` 参照）を設置。
- **遵守事項**: `.env.example` には placeholder（`your_xxx_here` / `xxxxx`）のみ。実 URL・実トークンの混入禁止。検知時は即 `git reset` で除去し、漏洩した値はローテーション。
- **変更時は ADR 必須**（hook 無効化は禁止、例外運用は ADR で合意）。

## 9. 並行 Claude セッション時は `git worktree add` 強制

- **事実**: グローバル `~/.claude/CLAUDE.md` の規約。karusaku-emr 2026-05-21 事故（並行セッションによる stage 巻き込み）を受けた予防策。
- **遵守事項**: 同じ working tree で複数 Claude セッションを起動しない。並行タスクは `git worktree add ../<task-name>` で別ディレクトリを切る。
- **変更時は ADR 必須**（規約変更はグローバル CLAUDE.md と本ファイル両方に反映）。

---

## ADR 追加場所

`/Users/kanbararyousuke/Projects/carelink/docs/adr/NNNN-<slug>.md`（未整備の場合は本ファイルと同階層に `adr/` 作成）。
