# 引き継ぎ：2026年8月17日〜18日 セッション

新しいセッションはこの文書を最初に読むこと。**数値は書いた時点のもので腐る**ため、
現在値は必ず下記のコマンドで取り直すこと。

```bash
npm run lint          # 警告件数
npm run lint:debt     # 受容済み負債がベースラインどおりか
npx tsc --noEmit      # 型
npm run test:coverage:ci
```

## 1. このセッションでマージした PR（15本）

| PR | マージ commit | 内容 |
|---|---|---|
| #596 | 6a4bf740 | 退会処理の再実行不能・fail-open 5件と、障害時に無音になる可視化2件を根治 |
| #597 | a691fc52 | dependabot 3本を解決し ESLint 9 + flat config へ移行 |
| #598 | d1992133 | React 18 → 19 |
| #599 | 8e65c20a | register の flaky テスト（10秒タイムアウト）を根治 |
| #600 | 4f00f4ef | Supabase クライアントへ `<Database>` 型を配線し不整合103件を根治 |
| #601 | bde7ea61 | database-overrides の「上書きが今も必要か」ガードを実在させる |
| #602 | 720a5721 | eslint-config-next 16.3.0 化＋React Compiler 負債ラチェット新設 |
| #603 | 108de34d | CI を本番と同じ Node 24 へ統一 |
| #604 | cde14c66 | jest worker 終了猶予 5000ms（リーク誤報の停止） |
| #605 | ea7e4aa7 | React Compiler 負債 72 → 6 件へ返済 |
| #606 | 351a8943 | lint 警告 86 → 11 件、残りを監視対象へ |
| #607 | 2d28d8af | 受容済み負債の根拠に書いていた誤った事実2件を訂正 |
| #608 | aabcf179 | 「遷移タイミングは従来と同一」という不正確な記述を訂正 |
| #609 | d060911c | 駅検索：開いた最初のフレームの「駅が無い」誤表示を根治 |
| #610 | 06cfb3a0 | 予約フロー／予約日時変更：取得前の「空きなし」「前日の枠」を根治 |

クローズした PR：#532（react-dom 単独更新で不整合）・#533・#536（#597 に統合）・
#534（ESLint 10 は上流未対応）・#561（対象ファイルが廃止済み）
クローズした Issue：#233（npm 脆弱性・実測0件）・#410（webhook 生産者は2箇所実在）

## 2. このセッションで確立した最重要の知見

### useEffect はブラウザのペイント後に走る

effect のトップレベルに `setLoading(true)` を置いても【最初のフレームには間に合わない】。
実測（2026年8月16日〜18日、本番ビルドを `next start` で配信し MutationObserver で計測）：

| 対象 | 修正前の最初の描画 | 修正後 |
|---|---|---|
| 駅検索 | 「該当する駅がありません」（39ms） | 「読み込み中...」（36ms） |
| 予約フローの空き状況 | 「この期間は予約可能な時間帯がありません」（43ms） | スピナー（30ms） |
| 予約日時の変更 | 初回は誤った「空きなし」／2回目以降は**前日の枠がそのまま** | スピナー |

いずれも【取得を試す前に「無い」と断定していた】。3件目は別日の枠を選ばせ得るため影響が大きい。

### 直し方の使い分け

- 発火元が1つ（イベント起点）：そのハンドラで setState する（例 StationSearch の `handleOpen`）
- 発火元が複数：**レンダー中に「取得済みの結果が今の条件のものか」を判定する**
  （`matrixQueryKey` / `matrixLoadedKey` / `matrixPending`、`slotsQueryKey` / `slotsLoadedKey` / `slotsPending`）
  各ハンドラへ setState を配ると1つ漏らした経路だけ誤表示が残り、新しい発火元を足す人が気づけない

### 🔴 やってはいけない直し方

`react-hooks/set-state-in-effect` は **effect 本体の直下という AST の形しか見ない浅い構文検査**。
実測で確認した変種：

```
A: useEffect(() => { load(); }, [load])                            → 検出される
B: useEffect(() => { (async () => { ...同じ処理... })(); }, [])     → 検出されない
E: useEffect(() => { setV(1); }, [])                               → 検出される
H: useEffect(() => { (async () => { await load(); })(); }, [load])  → 検出されない
J: useEffect(() => { (async () => { setX(true); await f(); })(); }) → 検出されない
```

H と J は実行時の挙動が A と完全に同一で、検出だけが消える。**症状ブロックなので不可**。

### 静的レビューの限界（実証済み）

上記の欠陥は Sonnet 8体の差分レビューも Opus 3体の独立評価も**全て見逃した**。
「effect のトップレベルにあるから即座に反映される」という誤った前提を全員が共有していたため。
構造的な欠陥（転記漏れ・依存漏れ・ボタンの無反応）には静的レビューが有効だが、
**描画タイミングのような実行時の性質は実ブラウザでしか捕まらない**。

## 3. 恒久ゲート（新設したもの）

| 仕組み | 何を守るか |
|---|---|
| `e2e/first-paint-loading.spec.ts` | 開いた最初のフレームに「試す前の結果」を出していないこと（4件・負の対照済み・chromium 限定） |
| `npm run lint:debt`（CI 配線済み） | 受容済み負債の件数がベースラインと厳密一致すること（増えても減っても赤） |
| `src/__tests__/eslint-flat-config-parity.test.ts` | lint 設定の取りこぼし |
| `src/__tests__/ci-node-version.test.ts` | ワークフローの Node 版が揃い engines を満たすこと |
| `src/lib/__tests__/database-overrides.test.ts` | 型上書きが今も必要か |

## 4. 意図的に残した負債（BASELINE=8・現在値は `npm run lint:debt` で確認）

`src/lib/react-compiler-debt.mjs` に理由を記載済み。内訳は set-state-in-effect 3件＋
incompatible-library 3件＋no-location-assign 2件。

- `gbp/page.tsx`：最初のフレームは**空白**で誤情報を出さない
- `ReviewSummary.tsx`：ルールベース要約という妥当なフォールバック
- `BookingFlow.tsx`（sessionStorage 復元）：マウント起点でハンドラが無い
- `incompatible-library` 3件：react-hook-form の `watch()` が原因。**React Compiler は未有効**なので実行時影響ゼロ
- `no-location-assign` 2件：退会後の全リロードは意図的（メモリ上の supabase-js と React state を破棄）

## 5. ローカル検証環境の作り方（重要）

Docker は **colima** 経由。`supabase start` は素直に通らないので除外指定が要る。

```bash
colima start                 # 落ちていたら（docker info で確認）
supabase start -x vector,logflare,studio,edge-runtime,imgproxy
supabase status -o env       # URL と鍵を取得し .env.local を作る
npm run build && npm run start
npx playwright test e2e/first-paint-loading.spec.ts --project=chromium
```

- `vector` を除外する理由：colima では docker socket をマウントできず起動に失敗する
- `npm run dev` は Turbopack が `next/font/google` を解決できず 500 になる。**本番ビルドを配信すること**
- E2E のシードは `SUPABASE_SERVICE_ROLE_KEY` を使う（`e2e/admin-batch.setup.ts` が手本）
- 施設だけでなく**スタッフも投入**しないと空き状況の effect が早期 return して検査が空振りする
- `.env.local` は作業後に削除すること（gitignore 済みだが混乱の元）

⚠️ ポート 54321 は他プロジェクト（karusaku-emr）の E2E スタブが掴むことがある。
`lsof -nP -iTCP:54321 -sTCP:LISTEN` で確認し、他プロジェクトのものなら**止めずに待つ**。

## 6. 次にやること（優先順）

1. **dependabot の新規5本**（#611〜#615）。#597 と同じ方針で、lock を触る複数本は
   1本にまとめてから取り込むとコンフリクトの往復を避けられる
2. **残る受容済み負債の再評価**。実機で測れる環境が整ったので、`gbp` と `ReviewSummary` を
   実際に測って「空白／フォールバックだから許容」が今も正しいか確認する
3. **`@supabase/*` が Node 22 以上を要求している件**。CI と本番は Node 24 に揃えたので現状問題ないが、
   `engines.node` は `>=22.22.2`。ローカルが Node 20 だと npm ci で警告が出る
4. **open Issue 4件**（#408 決済・#409 キャンセル待ち・#417 LINE代替・#527 LINE無条件送信）は
   いずれもローンチ範囲・製品判断待ちで、コードの不具合ではない

## 7. このセッションで撤回した自分の誤り（同じ轍を踏まないため）

- 「Docker は使用不可」→ colima で稼働していた。**試す前に不可能と断定していた**
- 「実機確認は代替できない」→ 本番ビルドを配信すれば公開ページは確認できた
- 「サーバーコンポーネント化が必要」→ 実験せず推論した誤り
- 「本物の同期 setState が68件／37件」→ 正規表現分類器の誤り。実ソース照合で反証
- 「4コミットは PR 未作成」→ 実際は #594 としてマージ済みだった
- 「effect のトップレベルに置けば即座に反映される」→ **ペイント後に走るので誤り**

いずれも「実測せずに断定した」ことが原因。**断定する前に実行して確かめること。**
