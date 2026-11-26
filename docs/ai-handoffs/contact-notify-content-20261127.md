# お問い合わせ受信通知に内容を載せる（ブランチ contact-notify-content）

- 依頼：Slack の受信通知が受付番号だけで中身が分からない。本人決定（2026-11-27）「名前・種類・本文冒頭」。
- 比較元：origin/main（cabf39d9）
- 変更：`src/lib/notify.ts`（contact に name・inquiry_type・message、`sanitizeContactField`・`contactPreview`）、`src/app/api/contact/route.ts`、`src/app/privacy/page.tsx` 第5条、`REGISTRATION_TERMS_SHA256`、テスト。
- 自己検証（最終 SHA 60dea050）：`npx tsc --noEmit` 0件、`npm run lint` エラー0、`npm run test:coverage:ci` 19,733件合格（coverage 基準を含む）、notify.ts の分岐 100%。

## Claude経由のCodex判定（2026-11-27）

| 回 | SHA | 判定 | 指摘 |
|---|---|---|---|
| 1 | 0e300c19 | 不合格 | CN-01 全角・括弧付き電話／名前欄のメール、CN-02 mrkdwn 記号 |
| 2 | 3ad36606 | 不合格 | CN-01 残り（U+2212 区切り）、CN-02 解消 |
| 3 | b8f2bc5c | 不合格 | CN-02 国際化ドメインのメール、CN-03 ゼロ幅文字 |
| 4 | 57c383f4 | 不合格 | CN-02「。」区切り、CN-03 U+FE0F、CN-04 日本語文を丸ごと伏せる退行 |
| 5 | 5eb35c08 | 不合格 | CN-04 英字ドメイン後の句点、CN-05 結合記号 |
| 6 | 8b68274e | 不合格 | CN-06 `taro@example。jp`、CN-07 国際化ドメイン後の文を巻き込む |
| 7 | 9a2dec86 | 不合格 | CN-08 U+034F |
| 8 | 8c0e8b13 | 不合格 | CN-09 `col·legi.cat` |
| 9 | a746e63f | 不合格 | CN-10 `mary.o'connor` |
| 10 | 60dea050 | 不合格 | CN-11（中）`taro@sub.例え。テスト` が `[email redacted]。テスト` になる |

CN-01〜CN-10 は解消済み（各回の Codex 再現で確認）。

## 未解決：CN-11（本人の判断待ち）

「。」はドメインの区切りにも文の句点にもなる。CN-07（`taro@例え.テスト。折り返し…` の後ろの文を残せ）と CN-11（`taro@sub.例え。テスト` の `。テスト` も伏せよ）は同じ形で、逆の結果を求めている。
現行の規則は「ドメインに `.` があれば、後ろが非英字の `。` は句点」。CN-11 の例で残るのはドメインの一部（`。テスト`）だけで、アドレスとしては復元できない。
選択肢：(A) 現行のまま（本文の読みやすさ優先） / (B)「。」を常に区切りとみなす（後続の文が次の句読点まで伏せられる）。
