# LINE 本人連携の切替

LINE ID を自分のプロフィールに書き込むだけでは、LINE アカウントの所有者とは認定しない。
新しい連携は、現在の Supabase 本人ログインと、自社チャネルの LINE トークン・プロフィールを
サーバで検証した上で `bind_verified_liff_account_atomic` により両方の記録を一括保存する。
既存の LINE ID・所有者行には `proof_version` / `verified_at` をバックフィルしない。

プロフィールと LINE 所有者・確認記録が一致した場合だけ、LIFF の個人データ・LINE ログイン・
顧客通知の対象になる。未確認の行は保持し、本人ログイン後の「LINE連携を再確認」から
その場の LINE 認証で確認する。別の所有者への移管、別 LINE への自動付け替え、外部解除は行わない。
旧 LINE-only アカウントに代替の本人ログイン手段がなければ個別復旧が必要であり、公開
`user_metadata` / メール一致 / 片側プロフィールから Auth を推測して発行しない。

新規 LINE-only Auth は admin の `app_metadata` に LINE ID と版を保存する。
SDK の作成結果が失われても、その管理側記録で同一 Auth を回収した場合だけ処理を進める。
管理側記録の候補は厳密に1件だけの場合に回収する。複数なら明示的に拒否し、任意の先頭行を
選ぶことも、曖昧な既存 Auth を削除・付け替えることもない。新規作成の成功応答も、保存された
唯一の候補と一致することを再確認してから連携・ログインを進める。
`auth.users` は Supabase の管理対象であり、索引作成・所有者変更・ロール昇格は要求しない。
外部 Auth 作成は DB を跨ぐため、Auth 行そのものを同時に厳密1件作成する保証とは称さない。
DB 側の確認済み LINE 所有者は既存の public UNIQUE で1人に限定し、曖昧な管理側記録は保留する。
magic link の発行・検証は同一 Auth ID を照合し、確認前・エラー・異なる利用者・遅延した SDK
cookie 更新をブラウザへ公開しない。登録失敗を既存メールのログイン成功へ変換しない。

follow webhook の DB エラーは返信前に HTTP 500 とする。返信前に全 follow の保存を済ませる。
既存の返信 token を push や別 token に変換せず、返信結果が不明なら応答にも `unknown` を残す。
LINE の再配信は同じ一回限りの reply token を保持するため、受信側だけで送達を断定しない。

本番ではこの migration が未適用なら、新 API は named RPC / 確認列の不足で安全に停止する。
旧 sender / OAuth /開いている旧画面は古いプロフィールだけを信用するため、切替は LINE 関連
送信・旧 OAuth の稼働を止めて実行中リクエストを drain し、migration と新アプリの準備完了を
確認してから再開する必要がある。旧 sender が残る時間を新しい保護の成立に含めない。
DB backstop は一般利用者の LINE ID 変更を拒否し、`service_role` の非 NULL ID 変更も
同一利用者の確認済み所有者記録が既にある場合だけ許可する。確認済みの所有者・LINE ID・
確認記録は既存 service 書込みでも変更できず、follow の表示名など通常編集は維持する。
既存 service による NULL クリアと DELETE は、保留中の既存解除処理を変更しないため保持する。
プロフィール ID の guard では、移行所有者 postgres を既存データ保持・正規 migration のため制限対象にしない。
確認済み所有者の不変条件は postgres の UPDATE にも適用する。
旧 OAuth はこのプロフィール書込みの失敗前に Admin magic link を発行して失敗を無視する。
DB のプロフィール guard は Supabase Auth の Admin API への旧経路を遮断できないため、
旧 OAuth の公開 preview/pinned URL・旧 credential 経路と scheduler の停止・drain は本番の
別の必須ゲートである。新 main の反映だけで旧経路がなくなったとは認定しない。
本人再確認が必要な既存対象は事前に読み取りで照合し、実 LINE 送信・解除・実データ削除を
切替検証のために行わない。本番の LINE/LIFF 設定、本人認証の完走、実配送は別途確認が必要。
