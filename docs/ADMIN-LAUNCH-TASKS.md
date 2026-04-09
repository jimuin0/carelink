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
- [ ] Stripe アカウントログイン情報（決済を使う場合）
- [ ] Sentry アカウントログイン情報
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

## 📦 タスク5: Sentry エラー監視の動作確認

**目的**: サイトでエラーが起きたら自動で通知が来ることを確認する作業

**所要時間**: 約15分（Vercel環境変数追加→Redeploy→確認）

### 5-1. Vercel 環境変数を追加

1. ブラウザで開く
   👉 https://vercel.com

2. CareLink で使う Vercel アカウントでログイン

3. ダッシュボードで **「carelink」** プロジェクトをクリック

4. 上部メニューの **「Settings」** をクリック

5. 左メニューの **「Environment Variables」** をクリック

6. 入力フォームに以下を設定:
   - **Key**: `SENTRY_TEST_TOKEN`
   - **Value**: 下記のような長めの英数字をランダムに生成して貼り付け
     - 例: `carelink-sentry-test-2026-04-09-xyz789` （20文字以上で何でもOK）
     - **メモ帳に控えておいてください**（後で使います）
   - **Environments**: `Production` と `Preview` 両方にチェック
   - **「Save」** をクリック

7. 上部メニュー **「Deployments」** をクリック

8. 一番上の最新デプロイの右側 **「⋯」（3点メニュー）** をクリック

9. **「Redeploy」** を選択 → 確認画面で **「Redeploy」** をクリック

10. 数分待って「Ready」（緑色）になるのを確認

### 5-2. Sentry にテストエラーを送信

1. ブラウザで以下のURLを開く（**TOKEN_HERE を実際の値に置き換え**）:
   ```
   https://carelink-jp.com/api/sentry-check?fire=1&token=TOKEN_HERE
   ```
   
   例: トークンが `carelink-sentry-test-2026-04-09-xyz789` なら:
   ```
   https://carelink-jp.com/api/sentry-check?fire=1&token=carelink-sentry-test-2026-04-09-xyz789
   ```

2. 画面に以下のような JSON が表示されれば成功:
   ```json
   {"ok":true,"fired":true,"dsnConfigured":true,"message":"Test error sent to Sentry. Check your Sentry dashboard within 1 minute."}
   ```

3. もし `{"ok":false,"message":"invalid token"}` が出たら → 環境変数の値が間違っています

### 5-3. Sentry Dashboard で受信確認

1. ブラウザで開く
   👉 https://sentry.io

2. CareLink プロジェクトの Sentry アカウントでログイン

3. 左メニュー **「Issues」** をクリック

4. 1分以内に新しいエラーが表示されることを確認:
   - タイトル: `[CareLink Sentry Test] Fired at 2026-04-09T...`
   - ✅ 表示されれば成功

5. テストエラーをクリック → 内容確認 → 右上の **「Resolve」** で消す

### 5-4. アラート設定（重要）

1. Sentry 左メニュー **「Alerts」** をクリック

2. 右上 **「Create Alert」** をクリック

3. **「Issue Alert」** を選択 → **Set Conditions**

4. 条件を以下のように設定:
   - **When**: `A new issue is created`
   - **If**: 条件追加なし（全エラー対象）
   - **Then**: `Send a notification to email` → 自分のメールアドレスを選択

5. **Alert Name**: `CareLink 新規エラー通知`

6. **「Save Rule」** をクリック

### 報告事項

- [ ] Vercel `SENTRY_TEST_TOKEN` 設定完了
- [ ] Redeploy 完了
- [ ] テストエラー送信→Sentry受信確認OK
- [ ] アラートルール作成完了

---

## 📦 タスク6: Stripe 本番モード切替（決済を使う場合のみ）

> ⚠️ サイトで料金を取らない場合は **このタスクをスキップ** してください
> ⚠️ Stripeアカウントの審査が完了している必要があります

**所要時間**: 約20分

### 6-1. Stripe 審査状況の確認

1. https://dashboard.stripe.com にログイン
2. 右上の **「テストモード」** スイッチが OFF にできるか確認
   - OFFにできない = 審査未完了 → **このタスクは中止**して担当者に報告

### 6-2. 本番APIキーの取得

1. テストモードスイッチを **OFF** にする
2. 左メニュー **「開発者」** → **「API キー」** をクリック
3. **「シークレットキー」** の項目で **「キーを表示」** をクリック
4. `sk_live_...` で始まる長い文字列が表示される
5. **コピーする**（このキーは絶対に他人に見せないこと、メモ帳にも保存しない）

### 6-3. Vercel 環境変数を更新

1. https://vercel.com → carelink プロジェクト → Settings → Environment Variables
2. 既存の **`STRIPE_SECRET_KEY`** を探して **「Edit」**（鉛筆アイコン）をクリック
3. Value欄を `sk_live_...` の値で **上書き**
4. Environments: **Production のみ** にチェック（Preview はテストのままでOK）
5. **「Save」** をクリック

### 6-4. Stripe Webhook の本番再登録

1. Stripe Dashboard → 開発者 → **Webhooks**
2. **「+ エンドポイントを追加」** をクリック
3. **エンドポイント URL**:
   ```
   https://carelink-jp.com/api/payment/webhook
   ```
4. **送信するイベント** で以下を選択:
   - `checkout.session.completed`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. **「エンドポイントを追加」** をクリック
6. 作成されたエンドポイント詳細画面で **「署名シークレット」** の **「クリックして表示」** → コピー
   - `whsec_...` で始まる文字列

### 6-5. Vercel に Webhook シークレットを設定

1. https://vercel.com → carelink → Settings → Environment Variables
2. 既存の **`STRIPE_WEBHOOK_SECRET`** を **Edit**
3. Value欄を `whsec_...` の値で **上書き**
4. Environments: **Production のみ**
5. **Save**

### 6-6. Vercel Redeploy

1. Vercel → carelink → Deployments
2. 最新デプロイの「⋯」 → **Redeploy**
3. Ready になるまで待つ

### 6-7. 1円実機決済テスト（神原様立ち会い必須）

⚠️ **このステップは必ず神原様の指示・立ち会いのもとで実施してください**

1. 神原様に「Stripe本番化が完了したので1円テストの段取りをしたい」と連絡
2. 神原様指示の下、テスト用施設・1円メニューで決済→管理画面確認→返金まで実行

### 報告事項

- [ ] Stripe審査状況: 完了 / 未完了
- [ ] 本番APIキー設定完了
- [ ] Webhook再登録完了
- [ ] Vercel Redeploy 完了
- [ ] 1円テストは神原様と日程調整

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
✅ タスク5: Sentry動作確認＋アラート設定
[✅/⏭] タスク6: Stripe本番化（決済使う場合のみ）
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

### Q. Stripe Dashboard で「テストモード」を OFF にできません
A. 審査が完了していません。Stripe Dashboard のホームに「アカウントを有効化」のメッセージが出ているはずなので、必要書類を提出してください。

### Q. UptimeRobot のテスト通知が来ません
A. 迷惑メールフォルダを確認。それでも来なければ Alert Contacts のメールアドレスが正しいか確認。

### Q. Sentryのテストエラーが Dashboard に表示されません
A. 1分以上待ってリロード。それでも出なければ、ブラウザに表示された JSON のスクリーンショットを担当者に送る。

### Q. GSC で「URL検査」のリクエスト上限が出ました
A. 翌日に残りをやってください。

### Q. 作業中にエラー画面が出ました
A. **必ずスクリーンショットを撮ってから** 担当者に送ってください。エラーメッセージだけでは原因特定が難しいです。

---

## 📞 緊急連絡

作業中に以下が起きたら **即座に作業を中止して** 神原様に連絡:

- 実顧客のデータが見える画面に到達した
- 課金処理が走った（Stripeで通知が来た）
- パスワード変更を求められた
- 「データを削除する」系のボタンを押してしまいそうになった

**焦らず、わからない時は止まる。** これが事務員作業の鉄則です。
