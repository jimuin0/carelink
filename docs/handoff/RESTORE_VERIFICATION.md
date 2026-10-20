# 復元検証記録

対象機能基準: c33a53ac8c96422e4271e4a47d3403e226cecd91。
引継ぎブランチのGitHub push後、元worktree外の空フォルダへremote cloneし、秘密.envなし・node_modules独立npm ciで検証する。
実行結果は restore-results.json に記録する。未実施を成功扱いしない。
manifestはGit追跡対象をSHA256で照合する。manifest自身と事後証明用restore-results.jsonは循環を避けて対象外（Git commitで固定）。アーカイブ全体と各memberを照合する。
`python3 scripts/verify-handoff.py --restore-to ../carelink-evidence-restored` で新しい未存在フォルダへ復元する。既存先・絶対パス・../・link・改変内容・member不足/重複を拒否する。
別アカウント・別実機では未検証。本番DB/Auth/Storage復元、秘密値移転、実provider認証は未実施。

実施結果: remote clone 2ba890cc、Node22.23.3/npm10.9.9、npm ci独立939 packages、575 suites/12,330 tests成功・branches11,347/11,347、型成功、lintは既存warning4/error0。秘密.envなしビルドはSupabase設定不足で失敗。架空127.0.0.1:9/anon値を明示して再実行したビルドは成功（DB未接続timeout/fallback警告あり）。本番キー・本番DBは使用していない。localhost起動/auth/loginは200、password入力マーカーあり。実認証/実DB機能の成功とはしない。

アーカイブの実復元4件・hash照合成功。合成7ケースで正常復元、不正パス/絶対パス/リンク/重複/改変/既存先拒否を検証。Git追加差分と復元アーカイブへgitleaks8.30.1を実行し検出0。rawログは機密混入リスクのため公開せず、検証値・hashをrestore-results.jsonに保存。
