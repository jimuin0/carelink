> ⚠️ **移設ノート（2026-08-09）**: このスキルは元々 `soel` リポジトリに集約されていたが、
> セッションがそのプロジェクト自身を開いた時にだけ自動で読み込まれるよう、このリポジトリへ移設した。
> パス参照はリポジトリ相対に機械置換したが、venv パス・ローカル worktree の状態など
> Mac ローカル運用に固有の記述が残っている可能性がある。矛盾を見つけたら、
> このリポジトリ自身の CLAUDE.md（存在する場合）を正として扱うこと。

# /sync-claude-md-carelink — CareLink CLAUDE.md をコードと同期して書き直す

コードが正。CLAUDE.md はコードの現状を正確に反映した仕様書として書き直す。

## 原則
- **削除優先**: 古い記述・未実装セクションは迷わず削除
- **正確性優先**: 曖昧な説明よりコードから読み取った正確な値
- **簡潔に**: 1セクション = 必要最小限。冗長・重複は削除
- **コードにないものは書かない**: 「今後実装予定」等は禁止

---

## Step 1: 全ファイルを並行読み込み（Read ツールで同時実行）

以下を全て同時に Read すること:

- `CLAUDE.md`
- `package.json`
- `src/middleware.ts`
- `jest.config.js`
- `src/lib/csrf.ts`
- `src/lib/rate-limit.ts`
- `src/lib/cron-auth.ts`
- `src/lib/audit-logger.ts`

さらに以下のディレクトリ一覧を Bash で同時取得:
```bash
ls src/app/api/
ls src/app/api/admin/
ls src/app/api/cron/
ls src/lib/
```

**全ファイルを読み終えてから次のステップに進む。**

---

## Step 2: 差分リストアップ（修正前に必ず出力）

以下3カテゴリで差分を整理して出力する：

**A. 削除すべき記述**（コードに存在しない・古い仕様）
**B. 追加すべき記述**（コードに実装済みだが CLAUDE.md に未記載）
**C. 修正すべき記述**（コードと内容が矛盾している）

各セクションの確認基準:
- **技術スタック**: package.json の dependencies / devDependencies と照合
- **APIルート一覧**: `ls src/app/api/` の実ディレクトリ構造と照合
- **セキュリティ共通パターン**: csrf.ts / rate-limit.ts / cron-auth.ts / audit-logger.ts の実装と照合
- **Supabaseクライアント使い分け**: supabase-server.ts / supabase-server-auth.ts の export と照合
- **middleware.ts**: PROTECTED_PATHS・TTL・ロールチェックの実装値と照合
- **Jest設定**: jest.config.js の coverageThreshold と照合
- **環境変数**: コード内の `process.env.` 参照を grep して確認

出力後、ユーザーから「進めて」等の承認を得てから Step 3 に進む。

---

## Step 3: CLAUDE.md を書き直す

**必ず `CLAUDE.md` を Read してから Edit すること。**
（Read なしで Edit すると失敗する）

### 書き直しのルール

**維持するセクション（骨格を保つ）:**
1. プロジェクト概要 — スタック・デプロイ先（package.json から抽出）
2. ディレクトリ構成 — src/ の主要構造
3. セキュリティ・共通パターン — APIルート実装順序・Cron実装順序・Supabaseクライアント使い分け
4. APIルート一覧 — 実ディレクトリ構造から抽出（admin/booking/cron/liff/payment 等）
5. DBスキーマ（主要テーブル）— コードから参照されているテーブル名
6. 環境変数 — 必須・外部統合（コード内 process.env 参照から抽出）
7. テスト・CI — jest.config.js の coverageThreshold 実値・GitHub Actions ステップ
8. 開発コマンド — package.json の scripts から抽出

**上記リストにないセクションが CLAUDE.md に存在する場合:**
→ コードに対応する実装があれば維持、なければ削除

**各セクションの更新基準（どのファイルから読み取るか）:**
- バージョン: package.json の dependencies
- セキュリティ実装順序: csrf.ts・rate-limit.ts・cron-auth.ts・audit-logger.ts の実装
- middleware 保護パス: middleware.ts の PROTECTED_PATHS・MEMBERSHIP_CACHE_TTL_SECONDS
- カバレッジ gate: jest.config.js の coverageThreshold（branches/lines/functions/statements）
- Cron スケジュール: vercel.json または cron/*/route.ts のコメント・設定
- Supabase クライアント: lib/supabase-server.ts・supabase-server-auth.ts の export 関数名

---

## Step 4: 報告

```
削除: X件 — [削除した記述の概要]
追加: X件 — [追加した記述の概要]
修正: X件 — [修正した記述の概要]
```
