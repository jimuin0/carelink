# CareLink 作業規則

最初に [RESUME.md](RESUME.md)、[HANDOFF_AUDIT.md](HANDOFF_AUDIT.md) を読む。依存バージョンはpackage-lock.json、cronはsrc/lib/cron-jobs.data.jsonとdocs/render-cron-consolidation.mdを正とする。

- このプロジェクト内のみ。他チャットへの連絡・サブエージェント委任・ChatGPT内蔵スケジュールは禁止。将来の自動再開を約束しない。
- 元データを削除しない。秘密値、Cookie、個人情報をGit/ログへ入れない。
- 本人操作・外部所有者対応・未回収証拠をコード修正完了と混同しない。
- 本番通知/予約/店舗の試験、保留機能への着手、新規課金/公開/権限拡大は明示許可なしに行わない。
- APIは既存withRoute、CSRF、getUserによる認証、最新会員の原子書込権限、監査/安全な例外捕捉を踏襲する。
- schema-snapshot.jsonで列/表を確認し、service-roleはサーバ信頼文脈限定。公開読取anonを書込に使わない。
- CI課金制限だけで停止せず、ローカルで同等検証を行う。未実行CIを成功扱いしない。coverage branch100%を緩和しない。
- worktreeのnode_modulesを他checkoutへsymlinkしない。コミット前にsecret検査、配信後は実commit/healthを確認。
