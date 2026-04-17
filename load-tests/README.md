# CareLink 負荷テスト

## 必要なツール

```bash
# macOS
brew install k6

# その他
# https://k6.io/docs/getting-started/installation/
```

## テストの実行

### 1. 100同時予約テスト（ダブルブッキング確認）

```bash
# ローカル環境
k6 run concurrent-booking.js

# 本番環境（注意: テスト用施設IDを使用すること）
k6 run \
  -e TARGET_URL=https://carelink-jp.com \
  -e FACILITY_ID=<テスト用施設ID> \
  -e MENU_ID=<テスト用メニューID> \
  -e TEST_USER_TOKEN=<JWTトークン> \
  concurrent-booking.js
```

## テストの読み方

- **double_bookings**: ダブルブッキング件数（0であること）
- **p(95) < 2000ms**: 95%のリクエストが2秒以内に完了すること
- **http_req_failed < 5%**: エラー率5%未満であること

## 注意事項

⚠️ **本番環境では必ずテスト用施設IDを使用してください**
⚠️ **テスト用予約日付は `2099-12-31` などの遠未来の日付を使用してください**
⚠️ **テスト後は作成した予約データを削除してください**
