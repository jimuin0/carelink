# 問い合わせのボタン付き通知の見出しを Slack の見出し部品にする

- リポジトリ：jimuin0/carelink、ブランチ：claude/inquiry-slack-header-block、比較元：origin/main（cedd095d）
- 依頼（2026-11-27 本人）：見出しが「*未完了のお問い合わせ*」と記号のまま出る。恒久的な方法で直す
- 原因：Slack の mrkdwn は「*」の外側に日本語の文字が続くと太字にならない
- 合格基準：
  1. 見出しは header ブロック（plain_text）、説明・各行は plain_text の section。メッセージに「*」の書式を使わない
  2. 見出しは Slack 上限 150 文字以内（超える分は切る）
  3. ボタン（値・action_id）、リンク、20件ごとの分割、通し番号の表示は変えない
  4. 1通のブロック数は 50 以内（最大 43）
- 自己検証：npm run test:coverage:ci 19,846件合格・branches 100%、tsc・lint エラー 0
