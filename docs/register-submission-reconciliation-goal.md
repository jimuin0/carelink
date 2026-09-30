# 掲載フォーム送信結果の再照合契約

GOAL ID：CARELINK-REGISTER-RECONCILIATION-001

revision：1

親GOAL全体を変更せず、掲載フォームに直接影響する確定不具合2件の後続契約とする。

## 原依頼と正本

認証済みcurrent user contextから、今回の自動修正権限・制約に対応するspanを固定する。platformのmessage IDは公開されていないため捏造しない。canonical化は引用内部のUTF-8 bytes・末尾改行なしとする。

> 「神原のすること」を除き、必要に応じてPR作成、本番へのpush・merge・deploy、Supabase設定変更、実メール送信（神原のみ）、実アカウント登録、Googleアカウント選択までもあなたが実行です。GOALまでノンストップで復元不可の削除、料金発生するもの以外を進めて、一切止めずにGOALを満たしたら完了とする。

source SHA-256：ffe722f9fc52b586243d20a427e76093b4bf4519bf56d6767f1bdae51492f84c

ruleset：2026年9月16日-r39

manifest SHA-256：6f6f1dc76d9ed552e1f61c2ce93afcc4435229754ca37086396ae0397df7871b

準備・品質・Git契約は同bundleの検証済みhashを継承する。契約本文hashは自己参照を避け、固定後に作業記録へ外出しする。

## 技術的根拠と対象

調査snapshotはPR #642の`3e7e7c6582cb34ac366aad61f5d43841e1488043`。

- `RegisterForm.tsx`の146行付近では並列uploadの一件が拒否されると、他uploadの確定を待たずcatchへ進む。cleanup後に成功した画像を回収できない。
- 同225〜228行付近ではPOST後の通信断も一律cleanupする。DB保存後に応答が失われた場合、保存済み画像URLを壊し、同画面で再送を許してしまう。
- 同214〜224行付近は2xx応答のJSON不正やid欠落でも完了画面へ進む。

成果物は`RegisterForm.tsx`、送信・upload判定のlocal helper、関連unit/E2E、技術運用資料に限定する。第三者問い合わせの個人情報・実データは複製しない。顧客申告の原因がこれらと同一とは断定しない。

対象外は新規migration、サーバー冪等キー、5店舗運用の変更、決済、Stripe、キャンセル待ち、Google Calendar、LINE解除、本番データ書込み・実送信である。実DBからの生成型取得・本番検証は親GOALの接続依存nodeとして分離し、手編集型やCI例外化で代替しない。

## 要件traceと受入条件

| ID | 原依頼・根拠 | 受入条件・証拠 |
|---|---|---|
| R1 | GOALまで修正、uploadの部分失敗 | 全uploadがsettleしてから失敗を扱い、確定した成功pathを全てcleanupする。早期失敗＋遅延成功のunitで実証する。 |
| R2 | 復元不可の削除を除外、POST結果不明 | fetch例外、5xx、予期しないstatus、HTML/JSON不正では画像を保全し、同画面で再送を抑止する。照合が必要な案内を表示する。 |
| R3 | 既存仕様と正常動作を維持 | POST開始前の確定失敗と、既存APIで保存前拒否と裏付けられる400/403/429かつJSON error文字列だけを再送可能にする。既存エラー文言を維持する。 |
| R4 | 偽の完了と再発経路を除去 | 2xxかつsuccess=trueかつ有効なUUID idだけで完了へ遷移する。不正2xx/欠落idでは遷移もcleanupもしない。 |
| R5 | 通常工程をAIが実行 | 通常成功、二重クリック、部分失敗、明確拒否、結果不明の変更単位検証、独立固定差分レビュー、CIを通して既存PRへ統合する。 |
| R6 | 費用・実送信・実データ制約 | ローカル合成fixtureと既存隔離CIだけを使い、追加費用0円、外部顧客送信0件、本番書込み0件。 |

## 設計と準備判定

- 並列uploadの完了をallSettledで待つ。成功順ではなく元の写真枠順を維持する。
- POST開始前／明確拒否／確認済み成功／結果不明を明示的に分ける。結果不明時に自動retryや削除をしない。
- 同画面の再送抑止は同期refとUI disabledの両方で行う。再読込・別端末を跨ぐ完全な重複防止は保証しない。後続の安全な照合又はDB冪等設計は別計画とする。
- 成功UUID判定は既存の共通定数を利用し、route.tsへ共有exportを追加しない。
- 重大仮説は既存APIの400/403/429が保存前であることと、POST通信断では保存有無を判定できないこと。親担当も当該sourceを一次確認済み。認証済みユーザーの追加情報なしで局所的な安全修正に収束できる。
- 準備判定は独立照合PASS（親担当）。sourceから契約へのforward照合と契約からsourceへのreverse照合を通過。実装後の固定差分は再度親担当が監査する。

## Quality Acceptance Matrixとgate

| 適用項目 | 合格条件 |
|---|---|
| 利用者価値・業務正確性 | 正常登録と明確拒否後の修正再送を維持し、未確認を完了と表示しない。 |
| 異常・競合・部分失敗 | 遅延upload、通信断、不正応答、連打のunit/E2Eを成功させる。 |
| UX・accessibility | 結果不明を可視の説明と照合導線で伝え、送信disabledを支援技術でも認識できる。 |
| security・privacy | PIIをログや契約へ追加せず、CSRF/reCAPTCHA/レート制限を変更しない。 |
| 信頼性・復旧 | 結果不明の写真保全、再送抑止、残る照合制約を明記する。 |
| 保守性・性能 | 小さい判定helper、並列uploadの維持、共通UUID判定、branch検証を使う。 |
| 費用・法務・既存方針 | 追加費用・実送信なし、店舗数・保存期限・法務方針を変更しない。 |

必須gateは対象unit、変更helperの分岐、型検査、Lint、diff/secret検査、固定差分の独立レビュー、最新HEADの必須CIとする。実DB Contract・本番反映確認は親GOALと連動する条件付きgateであり、接続不足なら未完了を明記する。未知の全障害の不存在や世界全体の重複防止は完了条件にしない。

今回のlocal実装profileはSTANDARD_LOCAL、task-owned PRは既存Git契約に従うSTANDARD_REMOTE。認証・実メール・本番dataを使うHIGH_RISK操作は本契約で新たに開始しない。合成fixtureは実在顧客へ到達せず、cleanupはmock又は既存使い捨てCI内に限定する。
