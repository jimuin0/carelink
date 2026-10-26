# Codex への引継ぎ指示書（2026-10-21 時点）

Claude Code（2026-10-20〜21）から Codex へ戻すための指示書。Codex はこの文書を最初に読み、
末尾の「Codex へ貼る依頼文」に従って作業を再開する。過去の経緯は [RESUME.md](../../RESUME.md)
・[HANDOFF_AUDIT.md](../../HANDOFF_AUDIT.md)・[AGENTS.md](../../AGENTS.md) にある。

**2026-10-24 訂正**：下表 3 の「回答待ち」は古い。[PostGIS 実測と対応手順](POSTGIS_SECURITY_ADVISOR_20261024.md)を現在の正とする。
**2026-10-26 訂正**：下表 2 の初回日曜ジョブは確認済み。本番 `cron_logs` の最新各行は `customer-segment` 2026-10-25 07:00:38 UTC `success`（processed 0 / skipped 3）、`sync-google-ratings` 09:00:23 UTC `success`（0 / 0）、`weekly-report` 22:10:21 UTC `success`（0 / 0）。統合 Render `carelink-daily-summary` の週次レポートは HTTP 200・正常終了。処理数 0 のため週次メール送信の実運用確認ではない。再実行しない。

## 1. 現在地（2026-10-21 実測）

本指示書のマージ後は main の HEAD と本番 version が `9ae6af7` から進む（docs だけでも production はビルドされるため）。
再開時は `git log --oneline 9ae6af79..origin/main` が docs/handoff 変更だけであることと、本番 version が
その HEAD と一致し `healthy` であることを確認する。食い違いがあればそれ自体を調べる。

| 項目 | 値 |
|---|---|
| 引継ぎ前のアプリ基準 | `9ae6af79`（PR #756 まで。これ以降の main は本指示書などの docs 変更だけ） |
| 本番 `/api/health`（引継ぎ前に測定） | `healthy`・version `9ae6af7`・supabase/rate_limit/stripe/resend/cron すべて ok |
| 本番 DB migration | 下表の 8 本すべて適用済み（`supabase_migrations.schema_migrations` を name で照合） |
| Render cron | PR #734 の 5 サービス集約は切替完了（10/19 05:57 UTC 頃）。旧サービスは suspend 済み |
| 未マージ PR | #627（Stripe 依存更新。決済は保留のため触らない） |

引継ぎ検証の注意：`python3 scripts/verify-handoff.py` は **main では必ず失敗する**
（マニフェストは引継ぎコミット `447f71cb` 時点のファイル hash を固定しているため。コード変更後の
main では `missing or modified` になる）。照合は `git worktree add --detach <空ディレクトリ> 447f71cb`
で取り出して実行する（2026-10-21 実測で `Manifest verified: 1941 files`）。マニフェストは再生成しない。

## 2. 引継ぎ以降にマージ・本番反映したもの

すべて main へマージ済み・本番配信済み（Vercel production の配信成功を確認）。DB 変更は
Supabase MCP の `apply_migration` で本番へ適用した（今後の順序は 4 章の規則に従う）。

| PR | 内容 | 本番 DB |
|---|---|---|
| #739 | 問い合わせ返信が「送信結果不明」のまま 24h を過ぎたら運営が確認付きで終了できる | `20261020080000` / `20261020150000` 適用済み |
| #740 | 管理ダッシュボードの読み取りが止まったら 8 秒でエラー表示へ倒す（`src/lib/bounded-read.ts`） | — |
| #741 #747 | 依存更新（Stripe 以外）・follow-redirects の脆弱性修正 | — |
| #742 #744 | Render ヘルスチェック通知に失敗した依存名を載せ、共有 Slack グループから送る | — |
| #743 #746 | 閲覧数をサーバー側で 1 訪問 1 回だけ記録し、公開 RPC の入口を閉じた | `20261020140000` 適用済み |
| #745 | 空き枠 RPC をレート制限付き API 経由だけにした | `20261020150500` 適用済み |
| #748 #749 | 重複インデックス 8 本削除・RLS の `auth.uid()` を 1 回評価に・外部キーへインデックス | `20261021030000` / `20261021040000` 適用済み |
| #750 #751 | Supabase 資格情報の無い Vercel Preview でもビルドが通る（Preview には意図的に設定しない） | — |
| #752 | 「予約OK」バッジを実際にネット予約できる店舗だけに出す（予約ページと同じ判定） | `20261021060000` 適用済み |
| #753 | クーポンから選んだ利用者をメニュー一覧へ案内（行き止まり解消） | — |
| #754 | 写真を種類「メイン」で上げると検索カードの画像にもなる | — |
| #755 | 「訪問専門」の店舗は予約時に訪問先の住所を必須（備考欄を兼用・画面と API の両方で検証）。こだわり条件の選択肢に「訪問専門」を追加 | — |
| #756 | 店舗登録写真（`carelink-uploads`）の匿名一覧取得を停止（公開 URL の表示は不変） | `20261021090000` 適用済み |

本番データで行った操作（いずれも本人の判断・了承を得て実施）：
- テストサロンA（`2bde0db4…`）を非公開（draft）へ。監査ログあり。
- HAL 2 店舗のクーポンに対象メニュー（`coupon_menus` 20 行）を設定。
- 訪問専門 神原鍼灸院（`906ef10d-89d9-432a-b1a4-3725b2708665`）に写真 3 枚を本人ログインの管理画面から登録し、メイン写真を設定。
  これで予約準備条件を満たし、検索カードに写真と「予約OK」が出る。患者の顔が写る 2 枚は同意が無いため不使用。

## 3. 残課題（優先順）

| # | 内容 | 担当・状態 | Codex がやること |
|---|---|---|---|
| 1 | `carelink-uploads` の未参照ファイル 64 件（約 17.9MB）。7/12 のテスト申込 10 フォルダ 60 件＋9/29 の切替日 4 件。どの `salons` 行にも紐づかない | **本人が削除するか判断待ち**（エージェントは完全削除しない） | 本人が削除したと言ったら、使用中の 1 件が残り、未参照が 0 になったかだけ読み取りで確認する。抽出 SQL は下の「付録」 |
| 2 | 日曜の週次 cron 3 本（customer-segment・sync-google-ratings・weekly-report）の集約後初回 | **10/25 の3本とも本番 `cron_logs` で `success` を確認済み**。`weekly-report` の Render 応答も HTTP 200・正常終了。対象処理数は 0 | 再実行しない。対象が発生した時の実送信・内容は今回の確認範囲外 |
| 3 | Supabase 所有者対応：`public` の PostGIS に伴う `spatial_ref_sys` 公開書込権限と `st_estimatedextent` 指摘 | チケット `SU-513978` に回答あり。PostGIS の非破壊移設には本人の書面承認待ち。現行障害ではない | [10/24 実測・手順](POSTGIS_SECURITY_ADVISOR_20261024.md)を参照。承認なしに本番拡張を変更・外部送信しない。移設後はアドバイザーと位置検索を読み取りで確認 |
| 4 | 店舗登録の方針（誰を・どう掲載するか） | **本人の事業判断待ち** | 判断が出たら実装する。勝手に決めない |
| 5 | 実運用確認：本人による「新規登録→メール→ログイン→管理画面」と、実際の予約 1 件の受付・通知 | 神原鍼灸院のオーナーアカウントは 10/21 に本人ログイン済み（管理画面・写真登録は動作）。実予約の受付はまだ | 本番で試験予約はしない。本人が実予約を受けたら、通知メールと管理画面の表示を本人に確認してもらう |
| 6 | 本物の Google OAuth 受入 | 本人同意待ち・任意機能 | 優先度低 |
| 7 | 原票 149 件 | 回収不能が継続。現行開発の前提にしない | — |

### 意図して残しているもの（再指摘されても直さない）

- Supabase 性能アドバイザー `unused_index`（218）：利用が少ない今は未使用に見えるだけ。消すと利用増で遅くなる。
- `multiple_permissive_policies`（191）：統合は店舗間のデータ分離を壊す危険が大きい大改修。必要になったら設計から。
- セキュリティアドバイザー `security_definer_view`（`public.public_reviews`）：口コミ本体は投稿者の識別子・IP を含むため公開できず、
  安全な列だけを出すために作成者権限で動かしている（`20261014003207` に理由）。
- `rls_enabled_no_policy`（39 表）：サーバー（service role）専用の表。ポリシー無し＝ブラウザからは常に拒否で正しい。

### 保留（明示許可まで着手しない）

Stripe/決済（PR #627 含む）・キャンセル待ち・Google カレンダー時差・LINE 解除・実顧客への返信/代理掲載。

## 4. このセッションで確立した作業手順

- **本番 DB の変更は Supabase MCP の `apply_migration` だけ**で行う（SQL Editor の手打ち・履歴修復はしない）。
  migration 冒頭に `to_regclass('public.facility_profiles')` の接続先ガードを入れ、適用前後に `is_carelink` 付きの読み取りで確認する。
  本番の version 番号はファイル名と一致しない（適用時刻になる）。name で照合する。
- 順序は変更の種類で決める。
  - **追加（列・表・ビューの列追加・関数の追加）**：migration を本番適用 → アプリをマージ・配信。旧アプリはそのまま動く。
  - **権限縮小・削除（REVOKE・DROP・列の削除）**：先に、それを使わなくなったアプリ（置き換え先の呼び出し）を配信して本番 version を確認 →
    その後に migration を適用する。逆にすると、新しいアプリが配信されるまでの間、旧アプリが失敗する
    （例：`20261020150500` の anon 実行権の取り消しは、#745 の service role 呼び出しが配信される前だと空き枠 API が失敗し得る）。
  - 一度に両方が要る変更は、追加の migration → アプリ → 縮小の migration の段階に分ける。
- **ブランチ保護**：必須チェックは Lint & Type Check / Unit Tests + Coverage / Security Audit。ブランチが最新であることが必要、
  レビュー会話の解決が必須。E2E は必須ではないが結果は必ず確認する。auto-merge は使わない。
- **Codex レビューボット**（`chatgpt-codex-connector`）が P1/P2 を付ける。指摘は直してから返信し、GraphQL で解決済みにしないとマージできない。
- **スキーマ指紋**：migration を足したら `src/lib/schema-fingerprint.expected.json` を再生成する。ローカルに PG17 が無ければ
  CI（`schema-fingerprint.yml`）の成果物 `schema-fingerprint-expected` を取り込む。`storage` スキーマは対象外。
- docs だけの変更は Vercel のプレビュービルドが省かれる（`scripts/vercel-should-build.sh`）。production は常にビルドされる。
- 店舗オーナーとしての操作（写真登録など）はエージェントがパスワードを入力しない。本人にログインしてもらってから行う。
- 本番での試験予約・試験送信・データ削除はしない。予約フローは確認画面まで（送信ボタンは押さない）で確認する。

## 付録：未参照画像の抽出 SQL（読み取り専用）

```sql
with o as (select name from storage.objects where bucket_id='carelink-uploads'),
refs as (
  select s.photo_url as u from salons s where s.photo_url is not null
  union all select jsonb_array_elements_text(to_jsonb(s.photo_urls)) from salons s where s.photo_urls is not null
  union all select p.object_path from salon_submission_photos p
  union all select f.main_photo_url from facility_profiles f where f.main_photo_url is not null
  union all select ph.photo_url from facility_photos ph
)
select (to_regclass('public.facility_profiles') is not null) as is_carelink,
  count(*) as objects,
  count(*) filter (where not exists (select 1 from refs r where r.u like '%'||o.name)) as unreferenced
from o;
-- 2026-10-21: objects=65, unreferenced=64
```

## Codex へ貼る依頼文

```text
jimuin0/carelink の最新 main を取得し、docs/handoff/CODEX_INSTRUCTIONS_20261021.md を最初に読んでください。続けて RESUME.md・AGENTS.md・CLAUDE.md を読んでください。

2026-10-20〜21 は Claude Code が作業しました。PR #739〜#756 はマージ・本番反映済み、追加 migration 8 本も本番適用済みです。Render cron の 5 サービス集約も切替済みなので、再切替・再適用・同じ全体テストの再実行はしないでください。

最初の確認は次に限定してください：git status、git rev-parse HEAD、本番 /api/health の version、進行中の CI・デプロイの有無。引継ぎ照合は指示書 1 章のとおりマニフェスト対象コミット 447f71cb を別ディレクトリに取り出して行ってください（main での失敗は想定どおりです）。

その後、指示書 3 章の残課題を上から進めてください。本人判断待ち（未参照画像の削除・店舗登録方針）と外部待ち（Supabase サポート・10/25 の週次 cron）は区別し、待ちの間は独立して進められる改善・検証を続けてください。新しい不具合を見つけたら、原因を確認して修正し、テストで再発を止めてください。

CareLink のみ、このセッション内で進めてください。他チャットへの連絡・委任・ChatGPT 内蔵スケジュールは使わないでください。ブラウザ操作は Codex のサイドバー内で行ってください。

既存の予算・検査基準・停止条件・保留・公開条件を守ってください。秘密情報の公開、元データの削除、無断の課金・実顧客通知・本番での試験予約や店舗の試験変更・権限拡大はしないでください。本番 DB の変更は指示書 4 章の手順だけで行ってください。

報告では「実装済み・検証済み・本番反映済み・実運用確認済み」を分け、実行していない CI や本番確認を成功扱いにしないでください。
```
