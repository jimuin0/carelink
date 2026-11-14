# CareLink 負荷テスト

k6 を使った負荷テストスイート。

## インストール

```bash
brew install k6
```

## 実行先の制限

すべてのスクリプトは `local-target.mjs` の `requireLocalLoadTarget` を通り、**ループバック（`localhost` / `127.0.0.1` / `[::1]`）以外の `TARGET_URL` は起動時に拒否する**。本番・staging などリモートへの負荷は掛けられない（掛けてはいけない）。`TARGET_URL` 未指定時は `http://localhost:3000`。

## テスト一覧

| ファイル | 目的 | 実行時間目安 |
|---------|------|-------------|
| `concurrent-booking.js` | 同じ予約依頼（同一 Idempotency-Key）を2本同時に送り、受付結果が一致するかの確認（同時大量予約の検査ではない。DB 側の件数保証は PG17 の並行性ゲートが担う） | 1分未満 |
| `search-load.js` | 検索エンドポイント負荷・スパイク | 約3分 |
| `api-rate-limit.js` | レート制限の正確性検証 | 約2分 |
| `soak-test.js` | 長時間安定性・メモリリーク検出 | 30分（短縮可） |

## 実行方法

### 1. 同一依頼の受付一致テスト
使い捨てのローカル DB に合成施設を用意し、その内容を書いた fixture（`kind: carelink-isolated-booking-v2` ほか、スクリプト冒頭の検査を満たすもの）を絶対パスで渡す。fixture が無いと起動時に失敗する。
```bash
k6 run \
  -e TARGET_URL=http://localhost:3309 \
  -e CARELINK_BOOKING_FIXTURE_FILE=/absolute/local/fixture.json \
  concurrent-booking.js
```

### 2. 検索負荷テスト
```bash
k6 run search-load.js
```

### 3. レート制限精度テスト
```bash
k6 run api-rate-limit.js
```

### 4. ソークテスト（30分）
```bash
# 短縮版（5分）
k6 run -e DURATION=5m soak-test.js

# フル版（30分）
k6 run soak-test.js
```

## 判定基準

| 指標 | 合格条件 |
|------|---------|
| P95 レスポンス | < 3,000ms |
| P99 レスポンス | < 5,000ms |
| エラー率 | < 5% |
| ダブルブッキング | 0件 |
| レート制限正確率 | > 90% |
| ソーク後エラー率 | < 1% |

## 注意事項

⚠️ 実行先はローカルの使い捨て環境だけ（リモートはスクリプトが拒否する）
⚠️ テスト後は作成した合成データを使い捨て環境ごと破棄すること
