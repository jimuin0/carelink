# 復元検証記録

対象機能基準: c33a53ac8c96422e4271e4a47d3403e226cecd91。
引継ぎブランチのGitHub push後、元worktree外の空フォルダへremote cloneし、秘密.envなし・node_modules独立npm ciで検証する。
実行結果は restore-results.json に記録する。未実施を成功扱いしない。
manifestはGit追跡対象をSHA256で照合する。manifest自身と事後証明用restore-results.jsonは循環を避けて対象外（Git commitで固定）。アーカイブ全体と各memberを照合する。
`python3 scripts/verify-handoff.py --restore-to ../carelink-evidence-restored` で新しい未存在フォルダへ復元する。既存先・絶対パス・../・link・改変内容・member不足/重複を拒否する。
別アカウント・別実機では未検証。本番DB/Auth/Storage復元、秘密値移転、実provider認証は未実施。
