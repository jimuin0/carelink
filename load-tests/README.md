# CareLink 負荷テスト

k6 を使った負荷テストスイート。

## インストール

```bash
brew install k6
```

## テスト一覧

| ファイル | 目的 | 実行時間目安 |
|---------|------|-------------|
| `concurrent-booking.js` | 100同時予約・ダブルブッキング防止確認 | 約2分 |
| `search-load.js` | 検索エンドポイント負荷・スパイク | 約3分 |
| `api-rate-limit.js` | レート制限の正確性検証 | 約2分 |
| `soak-test.js` | 長時間安定性・メモリリーク検出 | 30分（短縮可） |

## 実行方法

### 1. ダブルブッキング防止テスト
```bash
k6 run \
  -e TARGET_URL=https://carelink-jp.com \
  -e FACILITY_ID=<テスト用施設ID> \
  -e MENU_ID=<テスト用メニューID> \
  -e TEST_USER_TOKEN=<JWTトークン> \
  concurrent-booking.js
```

### 2. 検索負荷テスト
```bash
# ローカル
k6 run search-load.js

# 本番
k6 run -e TARGET_URL=https://carelink-jp.com search-load.js
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
k6 run -e TARGET_URL=https://carelink-jp.com soak-test.js
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

⚠️ 本番環境での実行時は必ずテスト用施設IDを使用すること  
⚠️ テスト用予約日付は `2099-12-31` などの遠未来の日付を使用すること  
⚠️ テスト後は作成した予約データを削除すること  
⚠️ ソークテストは非ピーク時間帯（深夜）に実行すること  
