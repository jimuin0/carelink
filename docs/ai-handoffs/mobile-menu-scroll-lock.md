# スマホのメニューを開いている間、後ろのページを固定する

- リポジトリ：jimuin0/carelink、ブランチ：claude/mobile-menu-scroll-lock、比較元：origin/main（19fb0745）
- 依頼（2026-11-27 本人報告）：スマホのメニュー（右上の三本線）を開いてスクロールすると、後ろのページがスクロールされる
- 合格基準：
  1. SearchHeader（トップ・検索・施設ページ）と Header のスマホメニューを開いている間は body がスクロールしない
  2. 閉じる・画面を離れると元のスクロールに戻る（先に別の部品が止めていた値を壊さない）
  3. メニュー内のスクロールが端に達しても後ろへ伝わらない（overscroll-contain）
  4. 既存のヘッダー・Modal 等の動作を変えない
- 自己検証：npm run test:coverage:ci 19,832件合格・branches 100%、tsc・lint エラー 0。実機ブラウザでの確認は未実施（CI の E2E と本番反映後に確認）

## Claude経由のCodex判定（2026-11-27・対象 ffc9626ff67965cb72c8c39137f0c3f0cdd4c629）

**判定：不合格。** メニューと Modal のスクロールロックが競合し、片方を閉じると背景のロックが解除されること、および閉じる順序によっては両方を閉じてもロックが残ることを、React と jsdom で再現しました。

CareLink PR #1000 の `claude/mobile-menu-scroll-lock`、対象 `ffc9626ff67965cb72c8c39137f0c3f0cdd4c629` を `origin/main`（`19fb0745ffe7d96b8547cf2cb3d9e938ed12cb88`）と比較しました。ファイルは変更していません。

| 合格基準 | 確認結果 |
|---|---|
| 1. メニュー表示中の背景固定 | トップ・検索・施設ページの `SearchHeader` と `Header` がともにロックを呼ぶことを確認。`SearchHeader` 単独の開閉テストは合格。Modal と併用すると解除されるケースを再現。 |
| 2. 閉じる・画面を離れる際の復元 | 単独での閉鎖・アンマウントと、既存の `clip` の復元テストは合格。複数のロックが重なる場合と、同じヘッダーを維持する画面遷移に問題あり。 |
| 3. メニュー端でのスクロール伝播防止 | `SearchHeader` のスクロール領域に `overscroll-contain` が付くことを確認。`Header` への適用はなし。実ブラウザでの伝播は未確認。 |
| 4. ヘッダー・Modal の回帰 | 関連 Jest 4 スイート、22 件は合格。併用時の回帰を別途再現し、画面幅変更時の回帰をコードで確認。 |

### 指摘

- **ML-01｜重要度 高｜基準 1・2・4**  
  **期待値**　メニューか Modal のどちらかが開いている間は背景を固定し、両方を閉じたら元の値に戻る。  
  **実際値・再現手順**　`overflow: ''` から Modal → メニューの順で開き、Modal → メニューの順で閉じると、最初の閉鎖で `''`、最後の閉鎖で `'hidden'` になりました。開く順序と閉じる順序をともにメニュー → Modal にすると、Modal が表示中のまま `''` になりました。  
  **根拠**　フックが取得時の値を無条件に復元し、Modal は閉鎖時に空文字を代入します。両者の実装を組み合わせた React/jsdom で確認しました。[useBodyScrollLock.ts](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/hooks/useBodyScrollLock.ts:14) · [Modal.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/Modal.tsx:58)

- **ML-02｜重要度 中｜基準 2・4**  
  **期待値**　画面を離れたときや、画面幅が広がってモバイルメニューが非表示になったときに、背景をスクロールできる。  
  **実際値・再現条件**　コード上、検索・施設ページでメニューを開いたままロゴからトップへクライアント遷移すると、同じ `SearchHeader` が維持され、`isOpen` を解除する処理がありません。また、どちらのヘッダーも、メニューを開いてからデスクトップ表示幅に広げると CSS でメニューが隠れますが、`isOpen` はそのままで `body` のロックが残ります。  
  **根拠**　`LayoutSwitch` は対象ページ間で同じ位置に `SearchHeader` を描画します。ロゴリンクには閉鎖処理がなく、両ヘッダーのロックは表示幅に関係なく `isOpen` に従います。[LayoutSwitch.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/LayoutSwitch.tsx:65) · [SearchHeader.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/search/SearchHeader.tsx:110) · [Header.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/Header.tsx:25)

- **ML-03｜重要度 低｜基準 3**  
  **期待値**　メニュー内にスクロールが必要な場合は、項目までスクロールでき、端に達しても背景へ伝播しない。  
  **実際値**　`Header` のメニューは開いていても `overflow-hidden` と `max-h-80` の組み合わせで、縦スクロールと `overscroll-contain` の指定がありません。内容が高さ上限を超える場合、はみ出した項目が切れる構造です。  
  **根拠**　両ヘッダーのメニューコンテナのクラスを比較しました。実ブラウザで高さ上限を超える条件やタッチ操作は未確認です。[Header.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/Header.tsx:126) · [SearchHeader.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/search/SearchHeader.tsx:173)

読み取り専用環境で Jest のキャッシュ書き込みが拒否されたため、実行プロセス内でキャッシュの保存だけを抑止して関連テストを実行しました。対象コミットの稼働環境を確認できなかったため、実ブラウザの操作確認は未実施です。全体 CI も独立検査では未実行です。

## 指摘への対応（Claude）

- ML-01：修正。src/lib/body-scroll-lock.ts に止めている数を数える入口を作り、メニュー・Modal・ConfirmDialog をすべてここ経由にした。全部閉じたときだけ元の値に戻す。
- ML-02：修正。ページが変わったら閉じる・画面幅が広がってメニューが隠れたら閉じる（useMobileMenuAutoClose）。
- 本人の追加報告：メニューが開いたまま上部の「ログイン」を押すと、移動しても画面が変わらないように見えた。ヘッダー内のリンクを押したら、移動先が同じページでもメニューを閉じる（closeOnLinkClick）。
- ML-03：修正。Header のメニューも開いている間は縦スクロール＋overscroll-contain にした。
- 自己検証：test:coverage:ci 19,842件合格・branches 100%、tsc・lint エラー 0。

## Claude経由のCodex判定（2026-11-27・再検査・対象 1e678ecc0fc50a6e757cca4b83783094dc8d3940）

**判定：不合格。** CareLink PR #1000 の `1e678ecc0fc50a6e757cca4b83783094dc8d3940` では、前回の Modal との競合は解消しました。一方、`SearchHeader` と「駅から探す」を重ねると、メニュー表示中に背景のロックが外れ、開いた順序によっては両方を閉じた後にロックが残ります。React と jsdom で再現しました。

前回不合格の `ffc9626f` からの修正差分と、`origin/main`（`19fb0745`）からの PR 全体の差分を確認しました。ファイルは変更していません。

| ID・重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|
| **ML-01・高** | `body-scroll-lock.ts:11`、`Modal.tsx:59`、`ConfirmDialog.tsx:100`、`StationSearch.tsx:70–73` | どれか一つでも開いている間は背景を固定し、すべて閉じたら元の値に戻る | **Modal・ConfirmDialog との競合は解消。駅検索との競合は再現。** メニューと各ダイアログの開閉順を入れ替えた計8通りで、片方を閉じても `hidden` を維持し、両方を閉じると元の `clip` に戻りました。一方、「駅から探す」を閉じると、メニューが開いたまま `overflow` が空文字になります。駅検索を先に開いた場合は、続けてメニューを閉じると `hidden` が残ります。駅検索が共通のロック管理を経由せず、閉じる際に空文字を直接代入するためです。 |
| **ML-02・中** | `useBodyScrollLock.ts:23–44`、`Header.tsx:31,69`、`SearchHeader.tsx:116,119` | 画面遷移、デスクトップ幅への切り替え、上部の「ログイン」のクリックでメニューが閉じる。同じ URL へのリンクでも閉じる | **パス変更と画面幅変更の修正を確認。** 両ヘッダーで、パス変更とデスクトップ幅への切り替えを模擬するとロックが解除されました。上部の「ログイン」は実装上 `<a>` で、ヘッダーのクリック捕捉処理が遷移先に関係なくメニューを閉じます。同じ URL への遷移を伴う実ブラウザ操作は未実施です。 |
| **ML-03・低** | `Header.tsx:129–131`、`SearchHeader.tsx:176–179` | メニュー内を末尾までスクロールでき、端で背景へスクロールが伝わらない | **CSS の修正を確認。** 両ヘッダーとも、開いている間のスクロール領域に高さ上限、`overflow-y-auto`、`overscroll-contain` が設定されています。実ブラウザでのタッチ操作と端での伝播は未確認です。 |

**合格基準 1〜4 と回帰の確認範囲**

1. **背景固定** — 両ヘッダーの単独開閉では `body` がロックされました。駅検索を閉じるとメニュー表示中に解除されるため、基準を満たしません。
2. **閉鎖・離脱時の復元** — 単独の閉鎖・アンマウント、パス変更、画面幅変更、Modal・ConfirmDialog との併用を確認しました。駅検索を先に開く順序では、両方を閉じた後もロックが残るため、基準を満たしません。
3. **スクロール伝播防止** — 両ヘッダーの CSS 指定を確認しました。実ブラウザでの受入確認は未実施です。
4. **既存動作の回帰** — 関連 Jest **7スイート・61件が合格**しました。Modal の Escape・背景クリック・フォーカス、ConfirmDialog の確定・キャンセル・背景の `inert`・フォーカス復元を含みます。駅検索との競合が残るため、基準全体は不合格です。

読み取り専用環境では、Jest のキャッシュ保存だけを実行プロセス内で抑止しました。対象 SHA で稼働する画面を確認できなかったため、実ブラウザ受入と全体 CI の独立実行は未実施です。

## 再検査の指摘への対応（Claude）

- ML-01：根本対応。body.style.overflow を直接書いていた残り3か所（駅検索 StationSearch・写真ギャラリー PhotoGallery・管理画面の BoardScheduleGrid）も lib/body-scroll-lock.ts 経由にした。今後の再発は src/__tests__/body-scroll-lock-single-entry.test.ts が CI で止める（直接書けば落ちる・負の対照つき）。
- 自己検証：test:coverage:ci 19,844件合格・branches 100%、tsc・lint エラー 0。

## Claude経由のCodex判定（2026-11-27・3回目・対象 899c22253e4416a4e338959b950d4840174b7660）

**判定：不合格。** CareLink PR #1000 の `899c22253e4416a4e338959b950d4840174b7660` を再検査しました。前回の不合格原因だった駅検索とのロック競合は解消しました。ML-02 は、ブラウザの既定フォントサイズによって、表示中のモバイルメニューを開けない条件が残っています。

`1e678ecc..899c222` と `origin/main...899c222`（比較元 `19fb0745`）を確認しました。ファイルは変更していません。

| ID・重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|
| **ML-01・高／解消** | `body-scroll-lock.ts:11–23`、`StationSearch.tsx:71`、`PhotoGallery.tsx:38`、`BoardScheduleGrid.tsx:331`、`Modal.tsx:59`、`ConfirmDialog.tsx:100` | 一つでも開いている間は背景を固定し、最後に閉じたとき元の値に戻る | 5部品それぞれを `SearchHeader` と重ね、開く順と閉じる順を変えた計20通りを React/jsdom で確認。片方を閉じても `hidden` を維持し、最後に元の `clip` に戻りました。 |
| **ML-02・中／未解消** | `useBodyScrollLock.ts:32–36`、`Header.tsx:31,129`、`SearchHeader.tsx:116,178` | モバイルメニューが表示される幅では開ける。画面遷移や、メニューが非表示になる幅への変更で閉じる | CSS は `40rem`・`48rem`、自動閉鎖は `640px`・`768px` を使います。既定フォント20px相当では、幅750pxで `Header` のモバイルメニューが表示される条件ですが、自動閉鎖の判定はすでに成立します。生成CSSを確認し、750px相当の `matchMedia` を模擬した jsdom で、クリック直後に `aria-expanded=false`、`body.style.overflow=''` となることを確認しました。 |
| **ML-03・低／CSS修正確認** | `Header.tsx:129–131`、`SearchHeader.tsx:176–179` | メニューを末尾までスクロールでき、端で背景へ伝播しない | 両ヘッダーの開状態に高さ上限、`overflow-y-auto`、`overscroll-contain` があり、生成CSSで `overscroll-behavior: contain` を確認しました。実ブラウザでのタッチ操作は未確認です。 |
| **ML-04・低／再発防止テストの検出漏れ** | `body-scroll-lock-single-entry.test.ts:13,30–34` | 共通処理を経由しない `body` の `overflow` 書き込みをCIで検出する | 負の対照は代入式2形式を検査します。`document.body.style.setProperty('overflow', 'hidden')` は同じプロパティを書き換えますが、現行の正規表現では検出されないことを確認しました。現行コードでこの書き込みが残っているという指摘ではありません。 |

**合格基準1〜4の確認範囲**

1. **表示中の背景固定** — トップ・検索・施設ページの `SearchHeader` と `Header` のロック経路、および他部品との併用時の `overflow` 維持を確認しました。
2. **閉鎖・離脱時の復元** — 単独の閉鎖・アンマウント、併用時の復元、パス変更時の閉鎖を確認しました。表示幅の切り替えには ML-02 が残っています。
3. **スクロール伝播防止** — 両ヘッダーのCSS指定を確認しました。実際のスクロール伝播は未検証です。
4. **既存動作の回帰** — 関連 Jest **9スイート・74件が合格**。追加の jsdom 検査で、駅候補のキーボード選択と検索遷移、写真送りと Escape、管理画面の新規予約モーダルの開閉、Modal の Escape、ConfirmDialog のキャンセルを確認しました。ヘッダーには ML-02 の回帰があります。

読み取り専用環境のため、Jest のキャッシュ書き込みだけを実行プロセス内で抑止しました。内蔵ブラウザに接続できず、対象SHAの実ブラウザ受入は未実施です。全体CIも独立実行していません。

## 3回目の指摘への対応（Claude）

- ML-02：修正。画面幅の判定を CSS と同じ rem（Header 40rem・SearchHeader 48rem）にした。既定の文字サイズを変えた人でも、メニューが見える幅では閉じない。
- ML-04：修正。再発防止テストに setProperty('overflow')・cssText の代入も加えた（負の対照つき）。

## Claude経由のCodex判定（2026-11-27・4回目・対象 bfac265c3d05bd92215428d7319763249f55adc1）

## 判定：不合格

CareLink PR #1000 の `bfac265c3d05bd92215428d7319763249f55adc1` を再検査しました。ML-02 のブレークポイントのずれは解消しています。ML-04 は前回の再現式を検出するようになりましたが、同じ API 呼び出しに空白を入れると検出をすり抜け、背景のロックを解除できることを確認しました。

前回の `899c2225` からの差分と、`origin/main`（`19fb0745`）からの PR 全体差分を確認しました。ファイル変更はありません。

| ID・重要度・結果 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|
| ML-01・高・解消 | `body-scroll-lock.ts:11–23`、各呼び出し元 | いずれかの部品が開いている間は背景を固定し、最後の閉鎖で元の値を復元する | 両ヘッダー、Modal、ConfirmDialog、駅検索、写真ギャラリー、管理画面の予約モーダルが共通処理を使います。重複ロックの維持と元の値への復元は Jest で確認しました。 |
| ML-02・中・修正確認 | `useBodyScrollLock.ts:24–40`、`Header.tsx:31`、`SearchHeader.tsx:116` | メニューが表示される幅では開いたままになり、非表示になる幅や画面遷移で閉じる | 幅の判定が Tailwind の `sm` と `md` と同じ `40rem`・`48rem` になりました。パス変更、幅の変更、開いた時点ですでに広い場合の閉鎖は Jest で確認しました。 |
| ML-03・低・CSS 修正確認 | `Header.tsx:129–132`、`SearchHeader.tsx:177–180` | メニューを末尾までスクロールでき、端で背景に伝播しない | 両メニューの開状態に高さ上限、`overflow-y-auto`、`overscroll-contain` があります。タッチ操作と端での伝播は実ブラウザで未確認です。 |
| **ML-04・低・未解消** | `body-scroll-lock-single-entry.test.ts:13,30–35` | 共通処理を経由せず `body` の `overflow` を変更するコードを再発防止テストで検出する | 前回の `setProperty('overflow', 'hidden')` と今回追加した `cssText` 代入は検出します。`overflow` を `hidden` にした後、`document.body.style.setProperty ('overflow', '')` または `document.body.style.removeProperty('overflow')` を実行すると、jsdom で `overflow` が空文字になり、どちらも検出式は `false` を返しました。再発防止テストの検出漏れです。 |

**合格基準1〜4と回帰の確認範囲**

1. **表示中の背景固定** — トップ・検索・施設ページの `SearchHeader` と通常の `Header` が共通ロックを使う経路を確認しました。
2. **閉鎖・離脱時の復元** — 閉鎖・アンマウント、パス変更、幅変更、重複ロックの解除と元の値への復元を関連テストで確認しました。同じ URL へのヘッダーリンクのクリックで閉じる処理も差分で確認しました。
3. **スクロール伝播防止** — 両ヘッダーの CSS 指定を確認しました。実際のスクロール伝播は未検証です。
4. **既存動作の回帰** — 関連 Jest **9スイート・74件が合格**しました。既存ヘッダー、Modal、ConfirmDialog、管理画面の予約グリッドを含みます。

読み取り専用環境のため、Jest のキャッシュ保存だけを実行プロセス内で抑止しました。内蔵ブラウザの接続先が利用できず、対象 SHA のブラウザ受入は未実施です。全体 CI も独立実行していません。

## 4回目の指摘への対応（Claude）

- ML-04：方法を見直した。書き方を列挙するのをやめ、body の style を書き換える API（overflow 代入・setProperty・removeProperty・cssText）を空白の入れ方を問わず全部止める正規表現にした。比較（===）や読み取りは対象外（負の対照つき）。

## Claude経由のCodex判定（2026-11-27・5回目・対象 fa20ff2e733ed730a1b951994e61740e2e56b9da）

**判定：不合格。** CareLink PR #1000 の `fa20ff2e733ed730a1b951994e61740e2e56b9da` を再検査しました。前回の ML-04 の再現式は検出されるようになりましたが、同じ `removeProperty` をブラケット記法で呼ぶと検出をすり抜け、背景のスクロールロックが解除されることを確認しました。

前回コミット `bfac265c` からの差分と、`origin/main`（`19fb0745`）からの PR 全体差分を確認しました。前回からの実行コードの差分はなく、変更は再発防止テストと引継ぎ記録です。

| ID・重要度・状態 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|
| ML-01・高・解消 | `body-scroll-lock.ts:11`、両ヘッダーと5つの呼び出し元 | いずれかが開いている間は固定し、最後に閉じたとき元の値に戻す | 両ヘッダー、Modal、ConfirmDialog、駅検索、写真ギャラリー、予約モーダルが共通処理を使用。Jest で解除順を変えても `hidden` を維持し、最後に元の `clip` に戻ることと、同じ解除関数を2回呼んでも他のロックに影響しないことを確認しました。 |
| ML-02・中・解消 | `useBodyScrollLock.ts:24`、`Header.tsx:31`、`SearchHeader.tsx:116` | 表示幅では開け、画面遷移や非表示幅への切り替えで閉じる。同一 URL へのヘッダーリンクでも閉じる | メディアクエリは CSS と同じ `40rem`・`48rem`。パス変更、幅変更、リンククリックによる閉鎖を関連テストと差分で確認しました。 |
| ML-03・低・CSS 修正確認 | `Header.tsx:129`、`SearchHeader.tsx:177` | メニュー内を末尾までスクロールでき、端で背景へ伝播しない | 両ヘッダーの開状態に高さの上限、`overflow-y-auto`、`overscroll-contain` を確認しました。実ブラウザでのタッチ操作と端での伝播は未確認です。 |
| **ML-04・低・未解消** | `body-scroll-lock-single-entry.test.ts:15` | 共通処理を経由せず `body` の `overflow` を変更するコードを再発防止テストで検出する | 前回の空白付き `setProperty` とドット記法の `removeProperty` は検出しました。jsdom で `overflow` を `hidden` にした後、`document.body.style['removeProperty']('overflow')` を実行すると空文字になり、対象コミットの正規表現は `false` を返しました。現行アプリでの発生ではなく、再発防止テストの検出漏れです。 |

**合格基準1〜4と回帰**

1. **背景固定** — トップ・検索・施設ページの `SearchHeader` と通常の `Header` から共通ロックを使う経路を確認し、Jest で開状態の `overflow: hidden` を確認しました。
2. **閉鎖・離脱時の復元** — 閉鎖、アンマウント、パス変更、表示幅の変更、重複ロック時の復元を関連テストで確認しました。
3. **スクロール伝播防止** — 両メニューの CSS 指定を確認しました。実ブラウザでの受入確認は未実施です。
4. **既存動作の回帰** — ヘッダー、Modal、ConfirmDialog、管理画面の予約グリッドを含む関連 Jest **9スイート・74件が合格**しました。

読み取り専用環境に合わせ、Jest のキャッシュ書き込みだけを実行プロセス内で抑止しました。全体 CI は独立実行していません。ファイルの変更はありません。

## 5回目の扱い（Claude）

- ML-01〜03（画面の動き）はすべて解消と判定された。残る ML-04 は再発防止テスト（文字の並びで探す検査）の書き方の穴で、同じ系統の指摘が3回続いた。文字の並びで探す方法では、わざと崩した書き方を全部は止められない。合格基準を「通常の書き方（代入・setProperty・removeProperty・cssText）を止める」に揃えるかを本人に確認する（合格基準を AI 同士で決めないため）。

## 本人の判断（2026-11-27）

- 「今の内容で進めて」。ML-04 の合格基準を「通常の書き方（overflow 代入・setProperty・removeProperty・cssText）を検出する」に揃える。わざと崩した書き方（ブラケット記法の呼び出し等）までは求めない。画面の動き（ML-01〜03）は解消済み。
