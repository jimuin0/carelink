# 指示書：店舗掲載登録（/register）が失敗する件の根治

作成日：2026年8月20日
対象ブランチ：`origin/main`（318ce92）時点のコード。行番号はこの時点のもの。
検証方法：Opus 3体（うち1体は反証専任）＋ 使い捨て PostgreSQL 16 での実行検証。

---

## 0. 結論（先に読む）

実機で出たエラーの第1候補は **「掲載希望時期」を選択したことによる 500**。
`salons.desired_start_date` は `date` 型なのに、フォームは `immediately` 等の**列挙文字列**を送る。

**選択肢4つすべてで INSERT が失敗する。未選択のときだけ通る。**

これは推測ではなく実測で確定している（§1）。反証を専任させた1体も反証に失敗した。

さらに、この不具合が**誰にも気づかれなかった構造的理由**が3つある。いずれも同じ重さで直す必要がある：

- 失敗が Slack にも Sentry にも通知されない（`return` で 500 を返しているため。同型の穴が **179箇所/90ファイル**）
- ユーザーにも原因が伝わらない（400/403/429/500 とネットワーク断が**全部同じ文言**）
- テストが壊れた値を「正常系」として固定している（`route.post.test.ts:90`）

---

## 1. 事実の確定（実測ログ）

### 1-1. 型の不一致

| 項目 | 実体 | 根拠 |
|---|---|---|
| フォームの選択肢 | `''` / `immediately` / `within_1month` / `within_3months` / `undecided` | `src/components/register/RegisterForm.tsx:32-38` |
| クライアントの送信値 | 文字列のまま（`\|\| null` で空文字だけ null 化） | 同 `:181` |
| サーバーの検証 | `z.string().max(50)` ＝**日付検証なし** | `src/app/api/salons/route.ts:69` |
| サーバーの保存 | そのまま INSERT | 同 `:157` |
| DB の列型 | **`date`** | `supabase/migrations/20260320000001_initial_tables.sql:25` |
| 型の正（機械生成） | **`date`** | `src/lib/schema-fingerprint.expected.json:835` |

**変換箇所は経路上に1つも存在しない**（`src/` `scripts/` `e2e/` `supabase/` を全数走査。BEFORE トリガ・DOMAIN・CHECK・USING キャストいずれも無し。`salons` のトリガは `on_salon_created_audit` 1本のみで **AFTER INSERT**＝値を書き換えられない）。

### 1-2. 実行検証（使い捨て PG16 に同一 DDL を立てて実測）

```
INSERT ... desired_start_date='immediately'     → ERROR: invalid input syntax for type date: "immediately"  (22007)
                              'within_1month'   → 同上
                              'within_3months'  → 同上
                              'undecided'       → 同上
負の対照  NULL                                   → INSERT 0 1（成功）
負の対照  '2026-09-01'                           → 成功
```

PostgREST が実際に使う `json_populate_recordset(null::salons, body)` の形でも同じエラーになることを、別エージェントが独立に再現済み。**null 化も切り捨ても起きない。**

### 1-3. なぜ CI が全緑なのか

- `src/app/api/salons/__tests__/route.post.test.ts:21` が `@supabase/supabase-js` を丸ごとモックしており、Postgres の型検査が一度も走らない
- 同 **`:90` が `desired_start_date: 'immediately'` を「正常系の代表値」として固定**している（壊れた値を仕様として保存している状態）
- `/register` の送信を通す E2E は 1本も無い
- branches 100% でも捕まらない（分岐ではなく DB の型の問題のため）

### 1-4. 同型の防御が他ルートには入っている

`src/app/api/profile/route.ts:19-21` に「形式チェックだけでは 2026-02-30 等の不在日が通り、**DATE 列が拒否して 500 になる**」と明記され、`isValidIsoDate` で防いでいる。同じ防御が `/api/booking/[id]/change`・`/api/admin/bookings`・`/api/slots` に入っており、**`/api/salons` だけ入っていない。**

---

## 2. 神原さんに実行していただくこと（2つ。どちらも読み取りのみ）

### 2-1. 実機での切り分け（1分）

`/register` を開き、DevTools の Network を開いた状態で送信する。`POST /api/salons` を見る：

| 観測 | 意味 |
|---|---|
| **500** かつ「掲載希望時期」を選んでいた | §1 で確定。未選択で再送すると成功するはず（これが決定的な確認） |
| **403** | reCAPTCHA か CSRF（§4-6 参照） |
| **429** | 60秒に6回目。失敗して連打すると必ず踏む |
| リクエスト自体が飛んでいない | 写真アップロード段で落ちている。Console に Storage の 4xx が出る |

### 2-2. 本番 DB の実型と保存値の確定（SELECT のみ）

Supabase Dashboard（project ref `xzafxiupbflvgbarrihe`）の SQL Editor に貼る。
書き込み・DDL は一切しない。**`is_carelink` が true でなければ接続先が違うので結果を採用しないこと。**

```sql
-- CareLink 本番診断: salons.desired_start_date の【実型】と【実際に保存されている値】
-- SELECT のみ。project ref: xzafxiupbflvgbarrihe
with guard as (
  select (to_regclass('public.facility_profiles') is not null) as is_carelink,
         current_database()                                    as db,
         current_setting('server_version')                     as pg_version
)
select g.is_carelink, g.db, g.pg_version, x.section, x.key, x.value
from guard g
cross join (
  -- (1) 実型（★ 'date' なら本指示書のとおり／'text' ならドリフト＝別の重大事象）
  select '1_column_type' as section,
         a.attname       as key,
         format_type(a.atttypid, a.atttypmod)
           || ' | notnull=' || a.attnotnull::text
           || ' | default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '(none)') as value
  from pg_attribute a
  join pg_class     c  on c.oid = a.attrelid
  join pg_namespace n  on n.oid = c.relnamespace
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where n.nspname = 'public' and c.relname = 'salons'
    and a.attname = 'desired_start_date' and a.attnum > 0 and not a.attisdropped

  union all
  -- (2) トリガ全件（値を変換している経路が無いことの確認）
  select '2_triggers', t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger  t
  join pg_class     c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'salons' and not t.tgisinternal

  union all
  -- (3) 制約全件
  select '3_constraints', con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class     c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'salons'

  union all
  -- (4) 実際に保存されている値の分布（全部 (null) なら「4択を選んだ登録は1件も保存されていない」）
  select '4_stored_values',
         coalesce(s.desired_start_date::text, '(null)'),
         count(*)::text || ' 件'
  from public.salons s
  group by 1, 2

  union all
  -- (5) 規模感: 全行 / 非NULL / 直近30日
  select '5_totals',
         'salons 全行 / desired_start_date 非NULL / 直近30日',
         count(*)::text || ' / ' || count(s.desired_start_date)::text || ' / ' ||
         count(*) filter (where s.created_at > now() - interval '30 days')::text
  from public.salons s
) x
order by x.section, x.key;
```

**読み方**：`1_column_type` が `date` → 本指示書どおり。`text` → 本番がリポジトリとドリフトしている（＝ドリフト検知の失敗という別の重大事象）。

### 2-3. 併せて確認していただきたい設定（Dashboard 目視）

| 確認先 | 何を見るか | なぜ |
|---|---|---|
| Authentication → Providers → Email | **Confirm email** が有効か無効か | §3-3 の修正の効き方が変わる（ただし修正自体は設定非依存にする） |
| Vercel の環境変数 | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` と `RECAPTCHA_SECRET_KEY` の設定有無 | §4-6。secret だけ設定されていると**全件 403** |

---

## 3. 修正指示

### P0-1　`desired_start_date` の型不一致を根治する 🔴 最優先

**症状ブロック（500 を握って握りつぶす）ではなく、値の意味と列の型を一致させる。**

方針を2つ挙げる。**推奨は (A)。**

#### (A) 推奨：列挙値を列挙値のまま保存する（DB を実態に合わせる）

「すぐに掲載したい／1ヶ月以内／3ヶ月以内／検討中」は**日付ではなく意向**であり、`date` 列に入れる設計自体が誤り。

1. migration を1本足す。`§2-2` の `4_stored_values` が全部 `(null)` であることを確認してから実行する（日付データが1件でもあれば移行方針を再検討）：

```sql
-- 接続先ガード（CLAUDE.md の鉄則5に従う。誤った DB へ適用しても何も変えない）
do $guard$
begin
  if to_regclass('public.facility_profiles') is null then
    raise exception 'CareLink 本番ではありません。適用を中止します。';
  end if;
end
$guard$;

alter table public.salons
  alter column desired_start_date type text using desired_start_date::text;
```

2. サーバー側の検証を「列挙の受け口」にする（`src/app/api/salons/route.ts:69`）：

```ts
// 掲載希望時期は日付ではなく「意向」。列挙の外を保存させない。
// 定数は UI と共有し、選択肢を足したときに片側だけ腐らないようにする。
desired_start_date: z.enum(DESIRED_START_DATES).or(z.literal('')).optional().nullable(),
```

3. `DESIRED_START_DATES` を `src/lib/constants.ts` に置き、`RegisterForm.tsx:32-38` の `startDateOptions` と `route.ts` の両方がそこを参照する（`businessTypes` と同じ形）。**選択肢の値をフォーム側にだけ書ける状態を無くす。**

4. `src/lib/schema-snapshot.json` と `schema-fingerprint.expected.json` を `scripts/gen-schema-fingerprint.sh` で再生成してコミットする（忘れると CI が赤くなる）。

#### (B) 代替：API で日付に変換する

`immediately → 今日`、`within_1month → 今日+1ヶ月` のように変換して `date` のまま保存する。
**採らない理由**：「検討中（undecided）」を表せる日付が無い。null に倒すと「未選択」と区別できなくなり、情報が欠落する。

#### 検証（どちらの方針でも必須）

- `route.post.test.ts:90` の `desired_start_date: 'immediately'` を、**壊れた値を仕様として固定している箇所として修正する**。DB モックのままでは同じ穴が残るので、下の Contract テストを併設する。
- 🔴 **モックではない実 DB に対する回帰テスト**を1本足す。`jest.config.contract.js`（staging の実 DB を叩く）に、4つの選択肢すべてで INSERT が成功することを主張するテストを置く。**負の対照**として、`date` 型のままなら落ちることを確認してからコミットすること。
- E2E に `/register` の送信を通すスペックを1本足す（`e2e/` に register 系は現在1本も無い）。「掲載希望時期を選んで送信 → `/register/complete` に着地」を見る。

---

### P0-2　無音の 500 を構造で塞ぐ 🔴

**これが「誰も気づかなかった」真因。** `src/lib/with-route.ts` の catch は **throw された例外でしか発火しない**（`:116-127`）。ハンドラが `return NextResponse.json(..., {status:500})` した場合、`safeCaptureException` も `alertCaughtError` も呼ばれない。

`src/app/api/salons/route.ts:162-167` は `error` を捨てて `return` している。**Slack・Sentry ともに 0 件。**

横断調査の結果、同型の穴は **179箇所 / 90ファイル**（cron は `cron-logger.ts:68` が拾うので 0箇所）。とくに影響が大きいもの：

- `src/app/api/payment/webhook/route.ts:85,146,165,177,297`（Stripe webhook）
- `src/app/api/facility/setup/route.ts:153,170`（店舗化フローの心臓部）
- `src/app/api/contact/route.ts:53` / `src/app/api/review/route.ts:174` / `src/app/api/booking/route.ts:153,198,302,308,356,367`
- `src/app/api/profile/route.ts:44` ← **`with-route.ts:5` と `alert.ts:5` と `instrumentation.ts:8` の3箇所で「500 が数日放置された」再発防止の動機として名指しされている当のルート**

#### 直し方（列挙ではなく構造で塞ぐ）

`src/lib/with-route.ts` のハンドラ呼び出し（`:116`）を変える：

```ts
const res = await handler(request, ctx);
// 🔴 catch は throw された例外しか拾わない。ハンドラが「返した」500 も通知に載せる。
//    179箇所の return 型 500 を1箇所で塞ぐ（発火源の列挙は次に足される 500 を守らない）。
if (res.status >= 500) {
  alertCaughtError(sentryTag, new Error(`handler returned ${res.status}`), new URL(request.url).pathname);
}
return res;
```

原因（`error` の中身）まで通知に載せたいので、併せて通知つきヘルパーを SSOT にする：

```ts
export function serverError(tag: string, cause: unknown, route: string, userMessage = 'サーバーエラーが発生しました') {
  safeCaptureException(cause, tag);
  alertCaughtError(tag, cause, route);   // runAfterResponse 経由なので応答は遅れない
  return NextResponse.json({ error: userMessage }, { status: 500 });
}
```

両方入れると二重通知になるので、`serverError` が付けた内部ヘッダを `withRoute` 側で見て抑止する。

#### ガードテスト

`src/__tests__/silent-500-guard.test.ts` を新設。`src/app/api/**/route.ts` を走査し、`status: 500` を返す全箇所が通知経路に載っていることを機械強制する。
**空振り防止**として「走査対象が N 本以上」「既知の 500 箇所を M 件以上検出した」を併せて assert する（`stock-image-guard-wiring.test.ts` と同じ設計）。**負の対照**（通知を外すと実際に落ちる）を確認すること。

#### ドキュメントの訂正

CLAUDE.md の2箇所と `src/lib/alert.ts:44-46` のコメントが「**全 500 応答**の Slack 通知がこの経路」と書いているが、実装は「**throw 由来の** 500 のみ」。上の修正を入れれば記述が真になる。入れないなら記述を訂正する。**同じ誤情報が3箇所にある。**

---

### P0-3　エラーの原因をユーザーに伝える

`src/components/register/RegisterForm.tsx:191` が `if (!res.ok) throw new Error(...)` で status も body も捨てているため、**400 / 403 / 429 / 500 / ネットワーク断 / 写真アップロード失敗がすべて同一トースト**になる。

サーバーは原因別の文言を返している（`入力内容が不正です` / `Bot検知: 時間をおいて再度お試しください` / `短時間に多くのリクエストがありました` / `不正な写真URLです`）のに、**1文字も画面に出ていない。**

```ts
if (!res.ok) {
  const body = await res.json().catch(() => null);
  throw new Error(body?.error || '送信に失敗しました。時間をおいて再度お試しください。');
}
// catch 側は e instanceof Error ? e.message : 既定文言 を表示する
```

これは UX 改善ではなく**障害の可視化**。今回、原因の特定に3体のエージェントと実 DB 検証を要したのは、この1行が理由。

---

### P0-4　middleware がログイン済みユーザーの `?redirect` を捨てる

`src/middleware.ts:245-250` は、セッションを持つユーザーが `/auth/login` `/auth/signup` を開くと **`?redirect` を一切見ずに `/mypage` へ固定**する。

壊れている導線（4本）：

| 場所 | href |
|---|---|
| `src/app/register/complete/page.tsx:81-84` | `/auth/signup?redirect=/admin/onboarding&facility_name=…` |
| `src/app/register/complete/page.tsx:87` | `/auth/login?redirect=/admin/onboarding` |
| `src/components/Header.tsx:74` | `/auth/login?redirect=/admin`（PC「店舗ログイン」） |
| `src/components/Header.tsx:149` | 同（モバイル） |

`Header.tsx:69-70` のコメント「ログイン済みなら login ページの初回マウント replace が `/admin` へ送る」は**成立しない**。middleware はページの HTML / RSC ペイロード生成より前に 307 を返すので、その `useEffect` は一度もマウントされない。

#### 🔴 同時に直すべきオープンリダイレクト（新規発見・実測済み）

既存ガード `raw.startsWith('/') && !raw.startsWith('//')`（`login/page.tsx:36`・`signup/page.tsx:36`）は **`/\evil.com` を true で通す**。インストール済み Next 16.3.0 のソースを辿って外部遷移することを確認した：

```
router.push('/\evil.com')
 → app-router-instance.js:219  new URL(addBasePath(href), location.href)  → https://evil.com/
 → app-router-utils.js:25      isExternalURL = url.origin !== location.origin → true
 → navigate-reducer.js:34      completeHardNavigation() ＝ 外部サイトへ実遷移
```

（`/auth/callback/route.ts:34` は `` `${origin}${redirect}` `` の**文字列連結**なので `https://carelink-jp.com//evil.com` に正規化され、**外部へは出ない**。ここは同型ではない。）

正しい判定は origin 比較に統一する：

```ts
let dest = '/mypage';
const raw = request.nextUrl.searchParams.get('redirect') ?? '';
if (raw.startsWith('/')) {
  try {
    const candidate = new URL(raw, request.nextUrl.origin);
    if (candidate.origin === request.nextUrl.origin) dest = candidate.pathname + candidate.search;
  } catch { /* 不正 URL は既定の /mypage */ }
}
```

middleware・login・signup の3箇所を同一ロジックに揃える。
`redirect` が `/admin/*` を指しても権限チェック（`middleware.ts:191`）は次リクエストで通るので、抜け道にはならない（fail-closed が保たれる）。

#### テスト

`middleware-honors-redirect.test.ts` を新設：(i) `?redirect=/admin` → `/admin`、(ii) `?redirect=https://evil.example.com` → `/mypage`、(iii) **`?redirect=/\evil.com` → `/mypage`（負の対照）**、(iv) redirect 無し → `/mypage`（既存 `AUTH-1` の互換）。

既存の `middleware-redirect-cookies.test.ts:99-106` は `?redirect` を付けずに投げているため、この修正を入れても緑のまま通る（＝事故を固定しているテストではない）。

---

### P0-5　signup 成功後に遷移しない

`src/app/auth/signup/page.tsx:65` は `const { error } = await supabase.auth.signUp(...)` で **`data` を破棄**しており、`:88` は `setToast` のみ。`router.push` が無い。

メール確認が無効な設定なら**セッションは張られているのに画面は「確認メールを送信しました」のまま静止**し、`/register` からの店舗化フローが死ぬ。対照として `login/page.tsx:72-73` は正しく `router.push(redirect); router.refresh();` を呼んでいる。

**本番の設定を知る必要はない。`data.session` の有無が実行時の答え。**

```ts
const { data: result, error } = await supabase.auth.signUp({ ... });
if (error) { /* 既存のアカウント列挙対策はそのまま */ return; }

// session あり = メール確認が無効 → 既にログイン済み。login と同じく即遷移する。
// session なし = メール確認が有効 → メール待ちが正しい状態。文言のまま留まる。
if (result.session) {
  router.push(redirect);
  router.refresh();
  return;
}
setToast({ type: 'success', message: '確認メールを送信しました。…' });
```

- 確認が有効な本番 → `session` は常に null なので**アカウント列挙対策は完全に維持される**
- 確認が無効な本番 → 遷移する。Dashboard の設定が将来変わってもコード変更は不要

**回帰テスト**：`signUp` を `{ data: { session: {...} } }` と `{ data: { session: null } }` の2通りでモックし、**前者で `router.push(redirect)` が呼ばれ・後者で呼ばれない**ことを assert する。CLAUDE.md の `LineDeliveryOutcome` 節と同じ教訓（分岐の**結果**を主張する）がそのまま当てはまる。

CI の E2E はローカル Supabase（`config.toml:205` で `enable_confirmations = false`）で走るので、`e2e/auth.spec.ts` に「送信後に着地する」を足せば**この不具合は CI で恒久的に捕まる**（現在は見出しの表示しか見ていない）。

---

## 4. 併せて確認・修正すべきもの（P1）

| # | 内容 | 場所 |
|---|---|---|
| 4-1 | **CSP の `frame-src` に `https://www.google.com` が無い**。reCAPTCHA v3 は google.com の iframe を張るため、site key を設定すると `execute()` が失敗し得る（→ token null → **全件 403**）。さらに `recaptcha-client.ts:66` の `grecaptcha.ready()` に**タイムアウトが無い**ため、解決しなければ送信ボタンが「送信中…」のまま固まる | `src/middleware.ts:108`、`src/lib/recaptcha-client.ts:57-70` |
| 4-2 | **「外観 *」は必須ではない**。`required: true` は赤い `*` を描くだけで、送信前チェックがどこにも無い。写真0枚でも 200 で通る | `RegisterForm.tsx:23`、`MultiPhotoUpload.tsx:86` |
| 4-3 | **利用規約・許認可の同意がサーバー側で検証されていない**。`disabled` 属性のみが根拠で、`onSubmit` にも `salonInsertSchema` にも同意の項目が無い | `RegisterForm.tsx:435`、`salons/route.ts:36-80` |
| 4-4 | `/register` 送信後の**受付メールが1通も無い**。`salons` を見る cron も無い（`onboarding-followup` は `facility_profiles` 限定）ので、アカウント作成前に離脱した申込者は**永久に放置**される | `salons/route.ts`（mail import 無し）、`cron/onboarding-followup/route.ts:57-70` |
| 4-5 | 引き継ぎキーが **`/register` のメールと signup のメールの完全一致のみ**。不一致だと営業時間・写真・特徴・PR が**無音で全て消える**。警告もプリフィルも無い | `facility/setup/route.ts:71-79`、`complete/page.tsx:81`（メールを渡していない） |
| 4-6 | **営業時間が書き込み専用**。`business_hours_text` に保存されるが、読み手がリポジトリ全体に存在しない（型定義と書き込み元のみ）。確認ダイアログの「営業時間が管理画面に反映され」は**未達** | `facility/setup/route.ts:137` |
| 4-7 | **`prefecture` / `city` が構造的に常に null**。`salons` に列が無く setup も補完しない。公開ゲートも要求しない（menu/photo/staff の3条件のみ）。`/search` は `.eq('prefecture')` で絞るので、**公開しても地域検索に出ない** | `facility-publish-gate.ts`、`facilities.ts:59`、`admin/page.tsx:54-60`（チェックリストに基本情報が無い） |
| 4-8 | `/salon` の4ステップ図が、公開必須の**「スタッフ登録」を欠落**させている（`/register/complete` 側は正しく含む） | `src/app/salon/page.tsx:155-172` |
| 4-9 | `salons` への**重複送信ガードが無い**（`email`/`facility_name` に UNIQUE 無し・API も重複チェック無し）。タブ2枚・リロード再送で営業リードが重複する | `salons/route.ts:132-160` |

---

## 5. 実施順序

1. **§2-2 の SQL を実行**して本番の実型を確定する ← ここが分岐点
2. P0-1（型不一致）＋ P0-3（エラー可視化）を**1本の PR**にまとめる。Vercel Hobby の日次ビルド枠があるため、修正はできるだけ束ねる
3. P0-2（無音 500）は影響範囲が広いので**別 PR**。`withRoute` の1箇所変更＋ガードテスト＋CLAUDE.md 訂正で完結させる
4. P0-4（redirect ＋ オープンリダイレクト）＋ P0-5（signup 遷移）を**1本の PR**。どちらも認証導線で、テストも同じ層
5. P1 群は §2-2/§2-3 の結果を見てから優先度を決める

---

## 6. この指示書で「確定」と「未確定」を分けた根拠

**確定（実測またはコードで断定できるもの）**
- `desired_start_date` の型不一致と、4値すべてでの INSERT 失敗（PG16 で実行検証。PostgREST 形でも独立に再現）
- 無音 500 の機構と 179箇所という件数（`src/app/api/**/route.ts` の `status: 500` 全278箇所を機械走査）
- middleware が `?redirect` を捨てること、`Header.tsx:69-70` のコメントが誤りであること
- `/\evil.com` が既存ガードを通り、Next 16.3.0 の実装で外部遷移になること（インストール済みライブラリのソースで確認）
- signup に `router.push` が無いこと、`data` を破棄していること
- `business_hours_text` に読み手が存在しないこと（全文検索）

**未確定（本番でしか確かめられないもの）**
- 本番 `salons.desired_start_date` の実型（§2-2 で確定させる。ただし `text` だった場合はドリフト検知の失敗という別の重大事象）
- 本番の `enable_confirmations`（`config.toml` はローカル/CI 専用。リポジトリからは導出不能。ただし P0-5 の修正は設定非依存にしてある）
- 本番の reCAPTCHA 環境変数の設定有無（§4-1 の発火条件）
- 実機で出たエラーが送信時のトーストだったのか `register/error.tsx` の全画面エラーだったのか（後者なら起点が変わる）
- この不具合がいつからあるか（このワークツリーは shallow clone で 2026-08-05 までしか辿れない。**少なくともその時点で既に存在**）
