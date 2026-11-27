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
