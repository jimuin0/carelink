# クローラーによる CPU 使用と Firewall の変更（2026-10-29）

対象は CareLink（Vercel プロジェクト `carelink`・Hobby）。数値は本番のリクエスト記録（`vercel logs requests`）と、
実行ログの `[runtime-cpu-sample]`（プロセス CPU の上限見積もり。Vercel の課金値ではない）から取った。
無料の範囲で取れる記録は 1 時間（実行ログ）まで。詳細な CPU 集計は有料の Observability Plus が必要なので使っていない。

## 何が CPU を使っていたか

| 時間帯（UTC） | 関数の実行 | 主な発生源 |
|---|---|---|
| 01:28〜04:28（3 時間） | 2,328 回 | `Amzn-SearchBot` 1,080 回（うち条件付き `/search` 1,026 回、10 分ごとにきっかり 60 回）。海外から HTML だけを取る偽装巡回 約 600 回 |
| 06:02〜07:02（1 時間） | 2,711 回 | `meta-externalagent` 2,294 回（06:40 ごろから。すべて `/search`、ピークは 10 分 1,201 回＝毎秒 2 回） |

条件付きの `/search` は元から `noindex`（`search/page.tsx`）で、取得のたびに DB 付きで描画していた。

## 行った変更と結果

| 時刻（UTC） | 変更 | 結果（実測） |
|---|---|---|
| 05:0x（#860・`3fcdbc1`） | `robots.txt` に `Disallow: /search?` | 反映済み。ただし Amazon は 08:14 時点でも `robots.txt` を読み直していない |
| 07:13 | Firewall の Bot Protection を **Log（記録のみ）** | 何も止めない。下記「Bot Protection」参照 |
| 07:32（#863・`db5ead8`） | middleware：検索クローラーの条件付き `/search` と、収集クローラーに `meta-externalagent` を追加して 403 | 07:32〜07:42 で Meta 1,230 回・Amazon 62 回がすべて 403。一般のアクセスは 200。ただし関数は起動し、プロセス CPU 約 14 秒／10 分（起動 10 回） |
| 08:03 | Firewall の「CareLink collection crawler CPU guard」の UA 正規表現に `meta-externalagent` を追加（本人承認） | 08:03〜08:14 で Meta 1,304 回が CDN 側で拒否（関数は起動しない）。関数の実行は 83 回／11 分。プロセス CPU 約 3.6 秒（起動 2 回）≒ 1 日 約 8 分 |
| 13:02 | 記録専用ルール「CareLink optional crawler observation」を、Amazon の条件付き `/search` を拒否するルールに置き換え（本人承認）。条件は `raw_path` が `/search?` で始まるもの | **一致しなかった**。4 分待っても `x-vercel-mitigated` は付かず、実際の Amazon のアクセス（13:04）も `wafAction: allow` のまま middleware の 403。`raw_path` はクエリ文字列を含まないと判断 |
| 13:07 | 同じルールを、`path` が `/search` で、かつ検索パラメータ 18 種（`search/page.tsx` が読む 15 種と、サイト内リンクにある `q`・`zipcode`・`prefecture`）のどれかがある、という条件に変更 | 公開 2 秒後から CDN 側で拒否（下記） |

公開直後の手動確認（08:03）: Meta の UA で `/search?type=x` は 403（`x-vercel-mitigated: deny`）、同じ UA の `/robots.txt` は 200。
`facebookexternalhit`（リンクプレビュー）、`meta-externalfetcher`（利用者操作による取得）、通常のブラウザの `/`、`/admin`（ログインへ 307）、
UA `node` の `/api/health` はいずれも通常どおり。08:03〜08:14 の実流入でも、リンクプレビュー・cron・UptimeRobot・一般のアクセスは 200。

## CPU guard ルール（CDN 側で拒否・関数を起動しない）

- 変更前: [firewall/cpu-guard-before-20261029.json](firewall/cpu-guard-before-20261029.json)
- 変更後: [firewall/cpu-guard-after-20261029.json](firewall/cpu-guard-after-20261029.json)（差分は UA 正規表現に `|meta-externalagent` を足しただけ）
- 条件: UA 正規表現・GET/HEAD・`/robots.txt` 以外・本番環境。拒否は CDN のリクエスト数・転送量に数えられない（Vercel 公式）。カスタムルールは全プラン無料。
- 代表的な UA 12 種での照合: 新たに拒否されるのは `meta-externalagent` だけ。`facebookexternalhit`・`meta-externalfetcher`・Facebook/Instagram/LINE の
  アプリ内ブラウザ・Chrome・Googlebot・Twitterbot・Slackbot・UptimeRobot・`node` は変更前と同じく通る。
- アプリ側（`src/lib/crawler-policy.ts` の `NON_SEARCH_CRAWLERS`、`robots.txt`）も同じ扱いにしてある。Firewall を戻しても middleware が 403 で断る（関数は起動する）。

元に戻す手順（再配信は不要）:

```bash
vercel firewall rules update rule_care_link_collection_crawler_cpu_guard_TMmzAo --data "$(cat docs/handoff/firewall/cpu-guard-before-20261029.json)" --yes --project carelink --scope jimuin
vercel firewall diff --project carelink --scope jimuin
vercel firewall publish --yes --project carelink --scope jimuin
```

公開前なら `vercel firewall discard --project carelink --scope jimuin` で下書きを捨てられる。`publish` は他の未公開の下書きもまとめて
公開するので、必ず先に `diff` で内容を確認する。

## Amazon の条件付き `/search` を CDN 側で拒否するルール

- 変更前（記録専用・Amazon と Ahrefs を Log）: [firewall/search-observation-before-20261029.json](firewall/search-observation-before-20261029.json)
- 変更後: [firewall/filtered-search-guard-after-20261029.json](firewall/filtered-search-guard-after-20261029.json)
- 条件: UA が `Amzn-SearchBot`・GET/HEAD・`path` が `/search`・本番環境・検索パラメータのどれかが存在（パラメータごとに OR のまとまりを 1 つずつ、計 18）。
- 🔴 `raw_path` の前方一致では、クエリ文字列を条件にできない（13:02 に実測）。Vercel の資料にもクエリ文字列を含むという記載は無い。
- 公開直後の手動確認（13:07）:

| UA | パス | 結果 |
|---|---|---|
| Amzn-SearchBot | `/search?type=x`、`/search?area=tokyo&page=2` | 403・`x-vercel-mitigated: deny`（関数は起動しない） |
| Amzn-SearchBot | `/search?utm_source=x`（18 種以外） | 403（middleware。関数は起動する） |
| Amzn-SearchBot | `/search`、`/robots.txt`、`/`、`/tokyo` | 200 |
| Chrome | `/search?type=x` | 200 |
| Googlebot | `/search?type=x` ／ `/search` | 403（middleware・#863 のとおり）／ 200 |
| facebookexternalhit | `/` | 200 |
| Chrome | `/admin` | 307（ログインへ） |
| `node`（Render の cron・health） | `/api/health` | 200 |

- 公開後の実流入（13:07:51〜13:18:00・158 件）: `Amzn-SearchBot` 64 回がすべて CDN 側で拒否（関数は起動しない）。
  Amazon で関数まで届いた 403 は 1 回だけで、上の手動確認（`utm_source`）だった。Amazon の `/search` 本体などは 200（4 回）。
  関数の実行は 94 回、プロセス CPU 約 4.3 秒（起動 1 回）。cron（`node`）・UptimeRobot・リンクプレビュー・Googlebot・一般のアクセスは通常どおり。
  関数を動かしている残りの大半は、海外の多数の国から Mac の Chrome を名乗って地域ページを巡回するアクセス（76 回）で、今回の変更の対象外。
- 置き換えで、Amazon と Ahrefs の記録専用ルールは無くなった。Ahrefs は CPU guard ルールで以前から CDN 側で拒否している。
- 18 種以外のパラメータだけが付いた取得は、これまでどおり middleware が 403 で返す（`src/lib/crawler-policy.ts` の `shouldRefuseFilteredSearchCrawl`）。
  検索画面に新しいパラメータを足したら、このルールにも足すと CDN 側で断れる（足さなくても応答は変わらない）。

元に戻す手順（再配信は不要）:

```bash
vercel firewall rules update rule_care_link_search_header_observation_1TcEAe --data "$(cat docs/handoff/firewall/search-observation-before-20261029.json)" --yes --project carelink --scope jimuin
vercel firewall diff --project carelink --scope jimuin
vercel firewall publish --yes --project carelink --scope jimuin
```

## Bot Protection（Log のまま・Challenge にはしない）

07:13〜07:28 の記録で Bot Protection が「ボットらしい」とした 67 件には、**日本からの `/admin` への通常のアクセス 28 件**、`/api` 8 件、
**Render の cron・health-check（UA `node`）5 件**が含まれていた。Challenge にすると店舗の管理画面と定期処理が止まる。
この Firewall の Bypass（特定のアクセスを除外するルール）は Pro 以上でしか使えないため、除外で避けることもできない。
`meta-externalagent` は正規ボットとして Bot Protection の対象外（Log のまま 1,794 回／15 分 通っていた）なので、Meta への対策にもならない。
Log は記録だけで、リクエストは変えない（Vercel 公式）。

## 残り

- `Amzn-SearchBot` は `robots.txt` を読み直すまで、条件付き `/search` を 10 分 60 回取りに来る。13:07 からは CDN 側で拒否している（上記）。
- 海外からの偽装巡回（Mac の Chrome を名乗る・多数の国・地域ページ）は 13:07〜13:18 に 76 回あり、関数の実行の大半を占める。
  通常の閲覧と UA では区別できないため、止めるかどうか・どう止めるか（国やパスでの Challenge など）は利用者への影響を見て別途判断する。
- CPU の 1 日あたりの値は、10 分程度の短い記録からの上限見積もり。実際の月の使用量は Vercel の Usage 画面で確認する（画面は 3 倍措置の表示を含む）。
