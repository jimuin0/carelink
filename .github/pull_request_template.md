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
- [ ] PRのベースとの差分と `git status --short` を確認し、想定外のファイル・未コミット変更を見落としていない
- [ ] 秘密情報（API キー / Webhook URL / DB 接続文字列）を含めていない
- [ ] `console.log` / `debugger` / `TODO` の取り残しなし

### マイグレーション・環境変数
- [ ] `supabase/migrations/` を追加・変更した場合: 本文に**マイグレーション内容と適用順序**を記載
- [ ] 環境変数を追加・変更した場合: `.env.example` 更新 + Vercel 反映必要なら本文に明記
- [ ] DB スキーマ変更を含む場合: schema-snapshot・型・必要なスキーマ検査を確認し、指示MDの更新が必要なら対象と案を報告

### API・cron
- [ ] 新規 API ルート追加: 必要な検査を確認し、指示MDの更新が必要なら対象と案を報告
- [ ] 新規 cron の追加が明示許可されている場合: `src/lib/cron-jobs.data.json` と `docs/render-cron-consolidation.md` を確認し、関連定義・ドリフト検査・配信順を検証
- [ ] 外部依存（Supabase/Upstash/Stripe/Resend/LINE/Anthropic）呼び出し追加: try/catch + フォールバック実装済

### テスト・型
- [ ] `npm run lint` 通過
- [ ] `npm run lint:debt` 通過
- [ ] `npx tsc --noEmit` 通過
- [ ] `npm run test:coverage:ci` と分岐カバレッジ100%を確認
- [ ] 対象PRの先頭コミットについて、`.github/workflows/` の適用される検査・保護設定を確認。CIが動かない場合は共通指示に従いローカル代替を実行し、未実行CIと区別して記録
- [ ] 変更したロジックに対する追加テストを書いた

### 大規模変更（該当する場合）
- [ ] Next.js / Supabase / Stripe / React のメジャーバージョン更新: 影響評価ドキュメントを本文にリンク
- [ ] `needs-owner-approval` ラベル付与

## テスト計画
<!-- 動作確認手順を箇条書きで -->

## スクリーンショット（UI 変更時）
