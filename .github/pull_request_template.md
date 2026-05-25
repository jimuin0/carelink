## 概要
<!-- このPRが何を変えるか、1〜3行で -->

## 変更タイプ
- [ ] バグ修正
- [ ] 新機能
- [ ] リファクタ
- [ ] ドキュメント
- [ ] テスト追加
- [ ] 依存パッケージ更新

## 必須チェック（マージ前に確認）

### 安全性
- [ ] `git diff --cached --stat` を確認し、想定外のファイルが含まれていない
- [ ] 秘密情報（API キー / Webhook URL / DB 接続文字列）を含めていない
- [ ] `console.log` / `debugger` / `TODO` の取り残しなし

### マイグレーション・環境変数
- [ ] `supabase/migrations/` を追加・変更した場合: 本文に**マイグレーション内容と適用順序**を記載
- [ ] 環境変数を追加・変更した場合: `.env.example` 更新 + Vercel 反映必要なら本文に明記
- [ ] DB スキーマ変更を含む場合: `CLAUDE.md` の DB セクションを更新

### API・cron
- [ ] 新規 API ルート追加: `CLAUDE.md` の API 一覧に追記
- [ ] 新規 cron 追加: `vercel.json` に明示宣言 + Hobby プラン制約（≤daily）を確認
- [ ] 外部依存（Supabase/Upstash/Stripe/Resend/LINE/Anthropic）呼び出し追加: try/catch + フォールバック実装済

### テスト・型
- [ ] `npm run lint` 通過
- [ ] `npx tsc --noEmit` 通過
- [ ] `npm run test:ci` 通過
- [ ] 変更したロジックに対する追加テストを書いた

### 大規模変更（該当する場合）
- [ ] Next.js / Supabase / Stripe / React のメジャーバージョン更新: 影響評価ドキュメントを本文にリンク
- [ ] `needs-owner-approval` ラベル付与

## テスト計画
<!-- 動作確認手順を箇条書きで -->

## スクリーンショット（UI 変更時）
