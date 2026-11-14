# Cloudflare に公開閲覧専用の試験版を置いて測った記録（2026-11-03）

本人の承認（「無料の範囲で置く」「本番の公開情報を読むだけで置く」）を得て、PR #873 の版（head `f678359`）を
Cloudflare Workers の無料プランに一時的に置き、公開ページの表示と CPU 時間を測った。測り終えたあと削除した。

## 置き方

- 名前はランダム（`cl-ro-14bd7d74`）。workers.dev の URL だけで、独自ドメイン・本番の DNS・ルートには一切つないでいない。
- つなぎ先は本番の Supabase の**公開用の URL と anon キーだけ**。service role・CRON_SECRET などの秘密値は入れていない。
- `VERCEL_ENV=preview` を入れ、Vercel の Preview と同じ公開閲覧専用の判定（`src/lib/preview-capabilities.ts`）にした。
- ビルドは `npm run build:vinext`。送る大きさは圧縮前 11.9 MB（圧縮後 3.7 MB）。
  公式の上限（2026-10-29 更新の Limits）は Free・Paid とも圧縮前 64 MiB で、収まる。

## 結果

| 確認 | 結果 |
|---|---|
| 公開ページ（`/`・`/search`・`/search?area=tokyo`・`/tokyo`・`/osaka`・店舗ページ・`/register`・`/register/guide`・`/api/health`・`/robots.txt`） | すべて 200 |
| 管理画面・ログイン・マイページ（`/admin`・`/admin/registrations`・`/auth/login`・`/mypage`） | 403（公開閲覧専用で停止） |
| `POST /api/contact` | 403 |
| `POST /api/booking` | 428（入力チェックで停止。書き込みには service role が要り、試験版には無いので書けない） |
| `/api/health` | `degraded`・`scope: public-preview`（秘密値が無いことによる想定どおりの表示） |

**CPU 時間（`wrangler tail` の `cpuTime`・各ページ 3 回・計 21 回）**

| ページ | CPU 時間（ミリ秒） |
|---|---|
| `/` | 24 / 93 / 166 |
| `/search` | 140 / 212 / 70 |
| `/search?area=tokyo` | 63 / 240 / 139 |
| `/tokyo` | 140 / 190 / 125 |
| `/osaka` | 33 / 42 / 90 |
| 店舗ページ | 266 / 248 / 137 |
| `/register` | 80 / 53 / 32 |

- 21 回すべて `outcome: ok`。ただし 1 回あたり 24〜266 ミリ秒で、**無料プランの上限（1 リクエスト 10 ミリ秒）を大きく超える**。
  今回は止められなかったが、続けて使えば上限で止まる（Error 1102）見込みで、**本番の移行先として無料プランは使えない**。
- 有料プラン（Workers Paid・月 5 ドル）の上限は既定 30 秒で、今回の値なら収まる。CPU 時間は月 3,000 万ミリ秒まで基本料に含まれる
  （今回の中央値 約 130 ミリ秒なら、月 約 23 万回の表示まで）。課金の判断は本人。

## 見つかったこと

- 公開閲覧専用の止め方は、ページ（middleware）と `withRoute` を通る API にしか効かない。middleware の対象から `api/` を外しているため、
  `withRoute` を使っていない API（121 本）は、試験版や Vercel の Preview でも処理まで届く。書き込みに service role が要る API は、
  鍵が無いので書けない。公開用の anon キーで書ける範囲は、もともと誰でも Supabase に直接書ける範囲で、新しい危険は増えていない。
- 試験版の応答には検索除け（`X-Robots-Tag: noindex`）が付いていなかった。Vercel の Preview は Vercel 側が付けている。
  本番を Cloudflare へ移すときは、workers.dev の URL を止める（`workers_dev: false`）か、検索除けを付けること。

## 片付け

- `wrangler delete` で削除。削除後の URL は 404、`wrangler deployments list` も「存在しない」を返すことを確認。
- 手元のビルド結果・一時ファイル（公開用の鍵を書いた設定）・作業フォルダは削除した。
