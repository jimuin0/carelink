# Threads 自動投稿 設計メモ（2026年7月30日 調査）

CareLink の更新を Threads へ自動投稿する仕組みの設計。実装前の調査結果と設計判断をまとめる。
コードはまだ書いていない。神原さんの判断を仰ぐ項目を最後にまとめている。

---

## 1. Threads API の仕様（公式ドキュメントで確認済み）

Meta の公式 Threads API を使う。非公式スクレイピングは使わない。

### 投稿は2段階

```
1) コンテナ作成   POST https://graph.threads.net/v1.0/{threads-user-id}/threads
                  media_type=TEXT
                  text=<本文>            ※500文字まで（絵文字は UTF-8 バイト数で計上）
                  access_token=<token>
                  → creation_id が返る

2) 公開          POST https://graph.threads.net/v1.0/{threads-user-id}/threads_publish
                  creation_id=<1で得たID>
                  access_token=<token>
```

公式は【1と2の間に平均30秒あけること】を推奨している。サーバ側の処理完了を待つため。

### 必要な権限

| 権限 | 用途 |
|---|---|
| `threads_basic` | 全エンドポイントで必須 |
| `threads_content_publish` | 投稿エンドポイントで必須 |

### アプリ審査の要否 — ここが重要

【自分のアカウントに投稿するだけなら App Review は不要】。
Meta App Dashboard で自分を「Threads tester」として招待し、承認すれば即座に権限が使える。

App Review が必要になるのは【他人のアカウントに投稿させる場合】（＝掲載施設それぞれのアカウントに
投稿する機能を作る場合）。CareLink 公式アカウントへの投稿だけなら審査は要らない。

### アクセストークンの寿命 — 運用上の最大の注意点

```
短期トークン  1時間
長期トークン  60日（期限前にリフレッシュ可能）
```

【60日で失効する】。リフレッシュを自動化しないと、2か月後に無言で止まる。
これは今回のローンチ前に何度も見つけた「設定したのに動かない／動かなくなったのに誰も気づかない」と
同じ形の事故になる。設計に必ず織り込む。

### レート制限

【24時間あたり250投稿】。CareLink の想定投稿頻度（1日1〜数件）では全く問題にならない。

### 画像を付ける場合

メディアは【投稿時点で公開アクセス可能なサーバにホストされている必要がある】。
CareLink は施設写真を Supabase Storage に置いており公開URLがあるため条件は満たす。
ただし初版はテキストのみにするのが安全（後述）。

---

## 2. 何を投稿するか — 実データで確認した候補

本番の実データ（2026年7月30日 時点）。

| 素材 | 件数 | 投稿ネタとしての評価 |
|---|---|---|
| `blog_posts` | 20 | ◎ 施設が書くコラム。`is_published` / `published_at` / `slug` / `title` が揃っている |
| `platform_blog_posts` | 5 | ◎ 運営コラム。`description` もあり投稿文を作りやすい |
| `job_postings` | 5 | ○ 求人。ただし応募導線の整備待ち |
| `coupons` | 20 | △ 有効期限・条件があり、誤解を招きやすい |
| `facility_profiles`(published) | 3 | ◎ 新規掲載のお知らせ。ただし件数が少なく頻度が出ない |
| `feature_articles` | 0 | ✗ データ無し |

### 初版の推奨

【新規公開されたブログ記事（`blog_posts` + `platform_blog_posts`）を1日1回チェックし、
未投稿のものを投稿する】。理由：

- タイトルと本文が既にあり、投稿文を機械的に作れる（創作しない）
- 記事URLへ誘導でき、サイトへの流入という目的に直結する
- 掲載施設が増えなくても記事は増やせるので、投稿が止まらない
- クーポンや施設情報と違い、条件や期限の誤記リスクが低い

新規掲載施設のお知らせは【施設が増えてから】追加するのが現実的（今は3件）。

---

## 3. 設計方針

今回のローンチ前監査で繰り返し出た失敗パターンを、最初から潰す形にする。

### 方針1：実在するものだけを投稿する（創作しない）

投稿文は【DBにある title / description / slug から機械的に組み立てる】。
AI に文章を作らせない。作らせると、実在しない内容や誇大な表現が混ざる余地が生まれる。

```
例）
{記事タイトル}

{descriptionの先頭N文字}

https://carelink-jp.com/blog/{slug}
```

### 方針2：医療広告ガイドラインのNGワードを投稿前に必ず通す

`src/lib/medical-ad-guard.ts` の `findMedicalAdViolations()` が既にある。
鍼灸院・整骨院・クリニックの記事は、Threads に出す時点で【広告】に当たる。
違反語を含む記事は【投稿せず、Slack に通知して人が判断する】。
口コミで採用しているのと同じ扱い（投稿を止め、審査へ回す）。

### 方針3：表示・実行を設定に従属させる

LINE を `NEXT_PUBLIC_LIFF_ID` の有無で出し分けたのと同じにする。
`THREADS_ACCESS_TOKEN` と `THREADS_USER_ID` が両方入っていなければ、cron は何もせず正常終了する。
手動フラグは作らない（戻し忘れ・入れ忘れの両方を構造的に防ぐ）。

### 方針4：送信結果を握り潰さない

`sendLineText` 等と同じく【失敗時は throw せず false を返す】契約にし、
呼び出し側は戻り値を必ず確認して Slack 通知する。
「送ったつもりで届いていない」を無音にしない。

### 方針5：二重投稿を構造的に防ぐ

cron は Render と GitHub Actions で二重化されており、同時発火しうる。
既存の `cron_alert_claims` と同じ【claim-first】方式を使う。
投稿直前に `(job_name, claim_key)` を INSERT し、主キー違反(23505)なら他 run が先取り済みとしてスキップ。
`claim_key` は記事IDにする（同じ記事を二度投稿しない）。

さらに DB 側に投稿済み記録を持ち、【同じ記事を二度投稿できない】ようにする。

### 方針6：トークン失効を発症前に検知する

60日失効が最大のリスク。二重に守る。

- リフレッシュ用の cron を別途動かす（例：週1回、期限が近ければ更新）
- 期限が近づいたら Slack へ警告（無言で止まらせない）

---

## 4. 必要なもの

### 環境変数（Vercel Production）

| 変数名 | 用途 |
|---|---|
| `THREADS_USER_ID` | 投稿先の Threads ユーザーID |
| `THREADS_ACCESS_TOKEN` | 長期アクセストークン（60日・要リフレッシュ） |

値の投入は神原さんが行う（Claude はシークレットを扱わない）。

### DB（Supabase・DDL が必要）

投稿済み記録のテーブルが要る。これは【神原さんが SQL Editor で実行】する項目。
実装時に全文を提示する。想定する形：

```
threads_posts
  id, source_type ('blog'|'platform_blog'|...), source_id,
  posted_at, threads_media_id, status, error_msg
  UNIQUE (source_type, source_id)   ← 二重投稿の物理防止
```

UNIQUE 制約が本丸。アプリ側のチェックだけでは同時発火で抜ける。

### cron

`src/lib/cron-jobs.data.json` に追加する（SSOT）。`render.yaml` と `.github/workflows/cron.yml`
はそこから展開される。ドリフト検知テストが既にあるので、SSOT だけ直せば整合が取れる。

想定：`threads-post` 1日1回、`threads-token-refresh` 週1回。

---

## 5. 実装の順序（案）

1. `src/lib/threads.ts` — API クライアント。`postText()` は失敗時 false を返す契約
2. DDL 提示 → 神原さんが `threads_posts` を作成
3. `src/app/api/cron/threads-post/route.ts` — 未投稿記事を1件投稿。claim-first・NGワード検査・Slack通知
4. `src/app/api/cron/threads-token-refresh/route.ts` — トークン更新と期限警告
5. SSOT へ cron 追加
6. テスト（branches 100% 維持）＋ 敵対検証
7. 神原さんが環境変数を投入 → 実機で1件テスト投稿して確認

---

## 6. 神原さんに決めていただきたいこと

### (1) 投稿するアカウント

CareLink の公式 Threads アカウントは既にあるか。無ければ作成が必要。
【自分のアカウントに投稿するだけなら Meta のアプリ審査は不要】なので、
アカウントさえあれば着手できる。

### (2) 投稿する内容

初版は【新規公開ブログ記事】を推奨。他に入れたいものがあれば教えてほしい。
候補：新規掲載施設のお知らせ、新着クーポン、求人。

### (3) 投稿の頻度と時間帯

1日1回を想定。時間帯（例：JST 12:00）の希望があれば。

### (4) 医療系記事の扱い

NGワードを含む記事は【投稿せず Slack 通知】を推奨する。
自動で投稿してしまうと、医療広告ガイドライン違反が外部に出てから気づくことになる。

### (5) 着手時期

ローンチ前に入れるか、ローンチ後にするか。
【ローンチ後を推奨】。ローンチ前に外部発信を増やしても、掲載施設が3件では受け皿が薄い。
また今は Vercel のビルド枠を消費したくない時期でもある。

---

## 7. 調査で確認した事実の出典

- Threads API 公式ドキュメント（developers.facebook.com/documentation/threads）
  - Get Started：権限・トークン寿命・アプリ審査の要否
  - Posts：エンドポイント・パラメータ・250投稿/24時間の制限
- CareLink 本番DB（service_role 経由の読み取り）：投稿素材の件数
- CareLink コード：`medical-ad-guard.ts` / `line.ts` の false 契約 / `cron-jobs.data.json`
