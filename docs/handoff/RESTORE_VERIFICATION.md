# 復元検証記録

対象機能基準: c33a53ac8c96422e4271e4a47d3403e226cecd91。
引継ぎブランチのGitHub push後、元worktree外の空フォルダへremote cloneし、秘密.envなし・node_modules独立npm ciで検証する。
実行結果は restore-results.json に記録する。未実施を成功扱いしない。
manifestはGit追跡対象をSHA256で照合する。manifest自身のみ循環を避けて対象外（Git commitで固定）。restore-results.jsonもmanifestのhash対象。アーカイブ全体と各memberを照合する。
`python3 scripts/verify-handoff.py --restore-to ../carelink-evidence-restored` で新しい未存在フォルダへ復元する。既存先・絶対パス・../・link・改変内容・member不足/重複を拒否する。
別アカウント・別実機では未検証。本番DB/Auth/Storage復元、秘密値移転、実provider認証は未実施。

実施結果: remote clone 2ba890cc、Node22.23.3/npm10.9.9、npm ci独立939 packages、575 suites/12,330 tests成功・branches11,347/11,347、型成功、lintは既存warning4/error0。秘密.envなしビルドはSupabase設定不足で失敗。架空127.0.0.1:9/anon値を明示して再実行したビルドは成功（DB未接続timeout/fallback警告あり）。本番キー・本番DBは使用していない。localhost起動/auth/loginは200、password入力マーカーあり。実認証/実DB機能の成功とはしない。

アーカイブの実復元4件・hash照合成功。合成7ケースで正常復元、不正パス/絶対パス/リンク/重複/改変/既存先拒否を検証。Git追加差分と復元アーカイブへgitleaks8.30.1を実行し検出0。rawログは機密混入リスクのため公開せず、検証値・hashをrestore-results.jsonに保存。

## Independent CI and retained private evidence

Commit 6b30b8e575e8aad5b62b5588f0ff8f729d4faa25: [CI39366685067](https://github.com/jimuin0/carelink/actions/runs/39366685067) succeeded. Unit: 575 suites / 12,330 tests; HTTPS browser E2E: 374 passed; local Supabase API contracts: 17 passed with zero skips; static migration contracts: 17 passed. This includes a fresh disposable database, schema generation and production build. Later changes affect only handoff metadata/index/archive/manifest, not runtime source. Always inspect PR735 live checks separately; the earlier successful CI is not a claim that every later head completed CI.

Sixteen private archives were restored into isolated temporary directories: all 12,683 file hashes matched their original manifests. All 3,566 unreachable Git objects were separately packed and verified in an empty bare repository. These are local preservation checks, not a completed private transfer.

## 再開ルール更新版の照合対象

資料更新前の元コミット: d9e56ce6465105687c01763c41cea0bd7f799771。コードの機能検証コミット: 6b30b8e575e8aad5b62b5588f0ff8f729d4faa25（上記CI）。完成した引継ぎ一式: `git log -1 --format=%H -- HANDOFF_MANIFEST.json` が返すコミット。これらを同じ意味で扱わない。manifest自身のみ除外、他1,941ファイルを照合する。
今回変更は資料5件とこの記録のみで、src/package/lockfile/CI/復元ツール/アーカイブの内容は変えない。そのため既存の全体テスト・build・起動証拠を再利用する。最終保存後は別の空フォルダへ `git clone --branch codex/carelink-resume-rules-20261020 https://github.com/jimuin0/carelink.git`、`python3 scripts/verify-handoff.py --restore-to ../evidence-restored` を実行し、GitHub取得コミットと結果を最終報告する。本文へ自己コミットhashを書き込む循環を避け、Gitがmanifest導入コミットを識別する。別実機・別アカウントや本番の再検証を意味しない。
