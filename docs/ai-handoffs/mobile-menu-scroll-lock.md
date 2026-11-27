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
