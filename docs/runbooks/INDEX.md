# Runbooks INDEX（症状ベース入口）

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 5分（分類）+ 各 runbook 参照 |
| 最終訓練日 | 2026-05-25 |

本ドキュメントは CareLink 本番環境で異常を検知した際の **最初の入口**。
症状から該当 runbook へ即座にジャンプするためのインデックスである。

---

## 1. 検知方法

### 自動検知パス
- **Slack `#alerts-prod`**: Sentry / Vercel Deployment / GitHub Actions failure 通知
- **Vercel Dashboard**: Deployments タブの failed / Functions タブの 5xx
- **GitHub Actions**: `.github/workflows/` 配下の cron / CI が red
- **Upstash / Supabase Dashboard**: usage / error チャートのスパイク
- **外形監視 `/api/health`**: 3 分連続失敗で通知

### 手動検知パス
- 神原さん or 関係者からの問い合わせ
- ユーザーからの「フォーム送信できない」「画面が真っ白」報告
- 自分のブラウザでアクセスして 5xx / 真っ白を目視

---

## 2. 初動 5 分（分類フェーズ）

1. **症状を 1 行で言語化する**（推測せず観測事実のみ）
2. 下表の「分類」列から該当する runbook を選び即移動する
3. 該当が無ければ最下段「該当しない場合の判断基準」へ

---

## 3. 判断分岐（症状 → Runbook）

| 症状 | 分類 | 遷移先 Runbook |
|---|---|---|
| API 5xx が急増 / Sentry エラー多発 | 5xx 急増 | [500-surge.md](./500-surge.md) |
| `vercel deploy` 失敗 / build エラー / cron 設定拒否 | デプロイ失敗 | [deploy-failure.md](./deploy-failure.md) |
| API キー / Webhook URL / token が git・log・Slack に出た | シークレット漏洩 | [secret-leak.md](./secret-leak.md) |
| Supabase / Stripe / Upstash / Resend / LINE が応答しない | 外部依存ダウン | [external-dep-down.md](./external-dep-down.md) |
| DB 接続不能 / マイグレ失敗 / RLS 違反 / trigger 異常 / 静かなドリフト（本番と repo 乖離） | DB 起因 | [database-incident.md](./database-incident.md) |

---

## 4. 復旧手順
本 INDEX は分類専用。復旧手順は遷移先 runbook を参照のこと。

---

## 5. 事後対応
- インシデント発生 → 該当 runbook 内「事後対応」セクションを実施
- いずれの runbook にも該当しなかった場合 → 新規 runbook 起票を検討（神原さんに相談）

---

## 該当しない場合の判断基準

以下の **全て** に当てはまる場合は「runbook 未整備の新症状」として扱う:

1. 上表 5 分類のいずれにも症状が当てはまらない
2. Sentry / Vercel logs / Slack のいずれにも自動通知が出ていない
3. 過去の commit log / runbook を grep しても類似事例が見つからない

判定後の行動:
- 観測事実を Slack `#alerts-prod` に投稿
- 神原さんに「分類不能のため判断を仰ぐ」と報告
- 復旧後に新規 runbook を起票（ADR とセットで）

---

## 6. 連絡先・参考
- 神原さん（責任者）
- Slack `#alerts-prod`
- Vercel Dashboard
- Supabase Dashboard
- GitHub repo: `kanbararyousuke/carelink`
