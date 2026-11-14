# CareLink 本番ローンチ 事務員向け作業手順書

> このドキュメントはエンジニアではない事務員が読んで、そのまま実行できるように書かれています。
> 不明点があったら **そのステップ番号を担当者に伝えて** ください。

最終更新: 2026-04-09
所要時間: 全部で約2〜3時間（決済設定込み）
担当: 事務員
報告先: 神原様 or Claude

---

## ⚠️ 作業前の準備

以下のアカウント・情報が手元にあるか確認してください:

- [ ] Google アカウント（CareLink で使うもの）
- [ ] Vercel アカウントログイン情報
- [ ] PAY.JP アカウントログイン情報（決済を使う場合）
- [ ] Slack（エラー通知の届くチャンネルを見られること）
- [ ] スマホ（SMS認証が必要な場合あり）

すべて揃ってから始めてください。

---

## 📦 タスク1: Google Search Console（GSC）apex プロパティ追加

**目的**: Google検索で carelink-jp.com が検索結果に出るように登録する作業

**所要時間**: 約3分

### 手順

1. ブラウザ（Chrome推奨）で開く
   👉 https://search.google.com/search-console

2. CareLink で使う Google アカウントでログイン

3. 画面左上の **プロパティ選択ドロップダウン** をクリック
   - 「プロパティを検索」と書かれたボックスです

4. ドロップダウン内の一番下にある **「+ プロパティを追加」** をクリック

5. 「プロパティタイプを選択」画面が出ます。**右側の「URL プレフィックス」** をクリック
   - ⚠️ 左の「ドメイン」ではなく、右の「URL プレフィックス」です

6. URL欄に以下を**正確に**入力（コピペ推奨）:
   ```
   https://carelink-jp.com/
   ```
   - ⚠️ www は付けない
   - ⚠️ 末尾のスラッシュ `/` を忘れずに

7. **「続行」** をクリック

8. 「所有権の確認」画面が表示されます。複数の確認方法が出ますが、**「Google Analytics」** を選んでください
   - すでに GA4 設定済みなので、これが一番速いです
   - 「Google Analytics」が選択肢に無い or 失敗する場合 → **担当者に「GA連携できない」と報告**

9. **「確認」** ボタンをクリック

10. 「所有権を確認しました」と出れば成功 ✅

### 報告事項

- [ ] GSC プロパティ追加成功
- [ ] 失敗した場合: エラーメッセージのスクリーンショットを担当者に送る

---

## 📦 タスク2: GSC サイトマップ送信

**目的**: Googleにサイトの全ページをまとめて伝える作業

**所要時間**: 約1分

### 手順

1. タスク1 で作成したプロパティが選択されていることを確認
   - URL: `https://carelink-jp.com/` のプロパティ

2. 左メニューの **「サイトマップ」** をクリック

3. 「新しいサイトマップを追加」のテキストボックスに以下を入力:
   ```
   sitemap.xml
   ```
   - 完全URL欄ではなく、ドメイン後の部分だけ

4. **「送信」** ボタンをクリック

5. 数秒後、下の表に新しい行が追加されます
   - ステータス: 「成功しました」と表示されればOK ✅
   - 「取得できませんでした」の場合は数分待って再度確認

### 報告事項

- [ ] サイトマップ送信成功
- [ ] 検出されたURL数（表示される数字）: ____ 件
  - 期待値: 約 2,900 件以上

---

## 📦 タスク3: 主要ページのインデックス登録リクエスト

**目的**: 「とくに早く Google に載せたい8つのページ」を優先登録する作業

**所要時間**: 約10分

### 手順

GSC のページ上部の **検索ボックス（「URL検査」）** に、以下の8つのURLを **1つずつ** 貼り付けて検査します。

各URL について:
1. URLをコピー
2. GSC上部の検索ボックスに貼り付け → Enter
3. 「URL は Google に登録されていません」と出たら、右上の **「インデックス登録をリクエスト」** ボタンをクリック
4. 数秒待って「リクエスト送信済み」の表示を確認
5. 次のURLへ

### 検査するURL一覧（8個）

1. https://carelink-jp.com/
2. https://carelink-jp.com/tokyo
3. https://carelink-jp.com/osaka
4. https://carelink-jp.com/type/hair-salon
5. https://carelink-jp.com/type/acupuncture
6. https://carelink-jp.com/symptom/low-back-pain
7. https://carelink-jp.com/blog
8. https://carelink-jp.com/jobs

### 注意

- 1日にリクエストできる回数に上限があります（10件程度）
- 上限に達した場合は翌日に残りを実施
- 「インデックス登録をリクエスト」ボタンが無い場合 = すでにインデックス済みなのでスキップOK

### 報告事項

- [ ] 8つのURLすべてリクエスト送信完了
- [ ] 上限エラーが出た場合は何個目で出たかを報告

---

## 📦 タスク4: UptimeRobot で外形監視を設定

**目的**: サイトが落ちたら自動でメール通知が来るようにする

**所要時間**: 約10分

### 手順

1. ブラウザで開く
   👉 https://uptimerobot.com

2. 右上の **「Sign Up Free」** をクリック

3. メールアドレス・パスワードを設定して登録（無料プランで十分）
   - Plan: **Free** を選択

4. 確認メールが届くのでリンクをクリック → ログイン

5. ダッシュボードで **「+ New monitor」** をクリック

6. 以下のように入力:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `CareLink Health Check`
   - **URL (or IP)**: `https://carelink-jp.com/api/health`
   - **Monitoring Interval**: `5 minutes`
   - **Monitor Timeout**: `30 seconds`（デフォルト）

7. **Advanced Settings** を展開（クリックで開く）
   - **Keyword Monitoring** にチェック
   - **Keyword Type**: `exists`
   - **Keyword Value**: `"status":"healthy"`
   - これで「healthy ステータスが含まれているかどうか」もチェックされます

8. **Alert Contacts To Notify** で自分のメールアドレスを選択
   - 初回はメールアドレスを追加する必要があります
   - SMS通知も無料枠で使えます

9. **「Create Monitor」** をクリック

10. 一覧に新しいモニターが追加されて、緑色の「Up」表示が出ればOK ✅

### テスト（任意）

- モニター行の **「Pause」** をクリック → 数分後に「ダウン通知メール」が来るか確認
- 確認できたら必ず **「Resume」** で再開してください

### 報告事項

- [ ] UptimeRobot 登録完了
- [ ] モニター作成成功（緑のUp表示）
- [ ] 通知メール用アドレス: ____________
- [ ] テスト通知の確認結果: 受信OK / 来ない

---

## 📦 タスク5: Slack エラー通知の動作確認

**目的**: サイトでエラーが起きたら Slack に通知が来ることを確認する作業

> Sentry は廃止済みで、`/api/sentry-check` は存在しません（開くと 404）。エラー通知は
> `instrumentation.ts` の onRequestError と `withRoute` の catch → `src/lib/alert.ts`（Slack）で行います。
> 疎通確認は `/api/alert-check` を使います（`docs/LAUNCH-CHECKLIST.md` の A5 と同じ手順）。

**所要時間**: 約15分（Vercel環境変数追加→Redeploy→確認）

### 5-1. Vercel 環境変数を確認・追加

1. Vercel の **carelink** プロジェクト → **Settings** → **Environment Variables** を開く
2. 次の3つが Production に設定されていることを確認（無ければ追加）:
   - `ALERT_CHECK_TOKEN`：20文字以上のランダムな英数字（値はパスワード管理ツールに控える）
   - `SLACK_BOT_TOKEN`
   - `SLACK_DEFAULT_CHANNEL`（通知先チャンネルのID）
3. 追加・変更した場合は **Deployments** → 最新デプロイの「⋯」→ **Redeploy** → 「Ready」になるまで待つ

### 5-2. テスト通知を送信

1. ターミナルで以下を実行する（`（ALERT_CHECK_TOKENの値）` を実値に置き換え）。ブラウザで URL に `?token=` を付けて開く方法は廃止（履歴・ログに残るため 401 になる）:
   ```
   curl -s -H "Authorization: Bearer （ALERT_CHECK_TOKENの値）" "https://carelink-jp.com/api/alert-check?fire=1"
   ```
2. 応答に `"fired":true` と `"slackConfigured":true` が含まれれば送信成功
   - `"slackConfigured":false` → `SLACK_BOT_TOKEN` / `SLACK_DEFAULT_CHANNEL` が未設定
   - `{"ok":false,"message":"invalid token"}` → `ALERT_CHECK_TOKEN` の値が不一致
3. Slack の通知先チャンネルに1分以内に `[alert-check]` のテスト通知が届くことを確認

### 報告事項

- [ ] `ALERT_CHECK_TOKEN` / `SLACK_BOT_TOKEN` / `SLACK_DEFAULT_CHANNEL` 設定確認
- [ ] `/api/alert-check?fire=1` の応答で `fired:true`・`slackConfigured:true`
- [ ] Slack でテスト通知を受信

---

## 📦 タスク6: PAY.JP 本番の設定（決済を使う場合のみ）

> 2026年11月14日に決済を Stripe から PAY.JP へ移した（Stripe のコード・秘密値・表は撤去済み）。
> 本番の設定は 2026年11月14日に完了している（下の報告事項）。鍵を入れ替えるときにこの手順を使う。詳しい経緯は `docs/handoff/PAYJP_MIGRATION_20261114.md`。

**所要時間**: 約15分

### 6-1. 本番利用の審査状況

1. https://console.pay.jp/d/application を開く
2. 「クレジットカード決済」の各ブランドが **「利用可能」** になっていることを確かめる（2026年11月14日：全ブランド利用可能）

### 6-2. 本番の鍵と webhook の照合トークン

1. 画面上部の **「テスト環境」スイッチを OFF**（ライブモード）にする
2. **API設定**（https://console.pay.jp/d/settings）の「APIキーの情報」で、**本番秘密鍵**（`sk_live_...`）と **本番公開鍵**（`pk_live_...`）を確かめる
3. 同じページの「Webhook」→「発信元トークン」（`whook_...`）を確かめる（テスト・本番で共通）

### 6-3. 置き場所

| 値 | 置き場所 | 入れ方 |
|---|---|---|
| 本番秘密鍵 `PAYJP_SECRET_KEY` | Cloudflare Worker の秘密値 | `npx wrangler secret put PAYJP_SECRET_KEY`（値は本人が貼る） |
| 発信元トークン `PAYJP_WEBHOOK_TOKEN` | Cloudflare Worker の秘密値 | `npx wrangler secret put PAYJP_WEBHOOK_TOKEN` |
| 本番公開鍵 `NEXT_PUBLIC_PAYJP_PUBLIC_KEY` | GitHub のリポジトリ変数（ビルド時に埋め込む公開値） | `gh variable set NEXT_PUBLIC_PAYJP_PUBLIC_KEY` → 次の配信で反映 |
| 広告枠のプラン ID `PAYJP_FEATURED_PLAN_ID` | Cloudflare Worker の秘密値 | 広告枠を売るときだけ（税込 10,780 円/月のプラン） |

### 6-4. webhook の送信先

1. API設定の「Webhook」→「Webhookを追加」
2. URL `https://carelink-jp.com/api/payjp/webhook`・**ライブモード** を選んで登録（イベントの選択は無い＝全イベントが届き、アプリが振り分ける）

### 6-5. 確認

1. `https://carelink-jp.com/api/health` の `deps.payjp.ok` が `true`（`skipped` でない）
2. API設定の「テストイベントを送信」で `charge.succeeded` を送り、`payjp_webhook_events` に `processed_at` 付きで記録される
   （テストのイベント ID は固定値なので、2 回目以降は重複として読み飛ばされる）

### 6-6. 実機決済テスト（神原様立ち会い必須）

⚠️ **このステップは必ず神原様の指示・立ち会いのもとで実施してください**

1. テスト用施設で有料オプションを申し込み → 管理画面で「利用中」→ 「解約」で解約予約済みになることを確認
2. PAY.JP 管理画面の「定期課金」で状態を確かめ、必要なら返金する

### 報告事項

- [x] 本番審査：全ブランド利用可能（2026年11月14日）
- [x] 本番秘密鍵・発信元トークン：Cloudflare に設定（2026年11月14日）
- [x] 本番公開鍵：GitHub のリポジトリ変数に設定（2026年11月14日）
- [x] webhook（ライブモード）登録・テスト送信の受信を確認（2026年11月14日）
- [ ] 実機決済テストは神原様と日程調整

---

## 📦 タスク7: Resend メール到達性チェック

**目的**: 予約確認メールが Gmail/Yahoo/iCloud に届くか確認

**所要時間**: 約15分

### 手順

1. https://carelink-jp.com にアクセス
2. 右上の **「新規登録」** をクリック
3. 以下の3つのメールアドレスで順番に新規登録
   - Gmail のアドレス（自分のテスト用）
   - Yahoo メール
   - iCloud メール
4. それぞれ確認メールが届くか確認:
   - 受信トレイ
   - **迷惑メール / スパムフォルダもチェック**

### 報告事項

| メール | 受信トレイ | 迷惑メール |
|-------|----------|-----------|
| Gmail | ✅ / ❌ | ✅ / ❌ |
| Yahoo | ✅ / ❌ | ✅ / ❌ |
| iCloud | ✅ / ❌ | ✅ / ❌ |

迷惑メールに入った場合 → **担当者に報告**（DKIM/SPF設定が必要）

---

## 📦 全タスク完了後の最終報告

タスク1〜7（決済使わないなら1〜5,7）が全部終わったら、以下を神原様に報告:

```
CareLinkローンチ準備 完了報告

✅ タスク1: GSC apexプロパティ追加
✅ タスク2: サイトマップ送信（検出URL数: ____件）
✅ タスク3: 主要8ページのインデックス登録リクエスト
✅ タスク4: UptimeRobot監視設定
✅ タスク5: Slack エラー通知の疎通確認（/api/alert-check）
[✅/⏭] タスク6: PAY.JP 本番設定（決済使う場合のみ）
✅ タスク7: メール到達性チェック

次のステップ:
- 1円実機決済テスト（神原様立ち会い）
- 実機E2Eテスト（神原様立ち会い）
- ソフトローンチ
```

---

## ❓ よくある質問

### Q. Vercel にログインできません
A. 神原様に連絡して招待してもらってください。

### Q. PAY.JP でライブモードの鍵が使えません
A. 本番利用の審査が終わっていません。https://console.pay.jp/d/application でブランドごとの状態を確かめ、審査中ならメールの連絡に返信してください。

### Q. UptimeRobot のテスト通知が来ません
A. 迷惑メールフォルダを確認。それでも来なければ Alert Contacts のメールアドレスが正しいか確認。

### Q. alert-check のテスト通知が Slack に届きません
A. 応答の `slackConfigured` を確認（false なら Slack の環境変数が未設定）。true なのに届かなければ、ブラウザに表示された JSON のスクリーンショットを担当者に送る。

### Q. GSC で「URL検査」のリクエスト上限が出ました
A. 翌日に残りをやってください。

### Q. 作業中にエラー画面が出ました
A. **必ずスクリーンショットを撮ってから** 担当者に送ってください。エラーメッセージだけでは原因特定が難しいです。

---

## 📞 緊急連絡

作業中に以下が起きたら **即座に作業を中止して** 神原様に連絡:

- 実顧客のデータが見える画面に到達した
- 課金処理が走った（PAY.JP で通知が来た）
- パスワード変更を求められた
- 「データを削除する」系のボタンを押してしまいそうになった

**焦らず、わからない時は止まる。** これが事務員作業の鉄則です。
