# Contract検証の実行先

実DB/APIへ到達する検証と、migrationの静的照合を分けます。mockで外部サービスの合格を主張しません。

| 必須検証 | 実行先 | 件数 |
|---|---|---|
| migration/生成型の静的ドリフト | 常時CI、credential不要 | 17 |
| Supabaseの読取・Auth応答・schema契約 | 全migration適用後の使い捨てSupabase | 12 |
| anon書込拒否とservice RPC拒否経路 | 同じ使い捨てloopback環境のみ | 5 |

GitHub ActionsのE2E jobは実Supabaseの3suite/17件を必須で実行します。結果guardは17件すべてpass、skip/todo/failゼロ、3ファイル一致を要求します。必要なlocalテストを削除していません。

引数なしの `npm run test:contract` は全suiteを実行し、接続不足や非localのmutation入力では失敗します。CIは以下の明示pathで実行先を選びます。

## 静的検証

```bash
npm run test:contract -- --runInBand --runTestsByPath tests/contract/migration-prod-drift.contract.test.ts
```

## 隔離実API検証

明示した `STAGING_SUPABASE_URL`、`STAGING_SUPABASE_ANON_KEY`、`STAGING_SUPABASE_SERVICE_ROLE_KEY` が必要です。Nextの.env自動読込みは無効です。

```bash
node scripts/check-local-supabase-contract.mjs environment
npm run test:contract -- --runInBand --runTestsByPath tests/contract/schema-invariants.contract.test.ts tests/contract/supabase-contract.test.ts tests/contract/local-mutation.contract.test.ts --json --outputFile=/tmp/local-contract.json
node scripts/check-local-supabase-contract.mjs results /tmp/local-contract.json
```

local-mutationの5件はRLSが退行するとINSERT等が成功し得ます。localhost/loopback以外ではテストbody開始前に失敗し、外部環境や本番へ実行できません。

## 任意の外部staging読取検証

原mainのci.ymlと同じく、外部stagingが設定されたときだけ追加実行します。3入力すべて未設定なら「未実行」をsummaryに明記し、成功証拠に含めません。部分設定は省略せず失敗します。新しい有料環境の作成はmergeの必須条件ではありません。

```bash
npm run test:contract -- --runInBand --runTestsByPath tests/contract/schema-invariants.contract.test.ts tests/contract/supabase-contract.test.ts
```

読取り12件すべてを検証するためURL/anon/serviceの3入力が必要です。設定不足をdescribe.skipで握り潰さず、実行すると失敗します。service keyは列/View存在のlimit0読取に使います。3入力は本番から隔離したstaging専用とし、本番URL/keyをCIへ注入しません。local-mutationはこの実行対象に含めません。

この層はAuth HTTP応答とschema/権限の基礎契約であり、SMTP送達・Google本人ログイン・行のあるtenant分離・実通知成功を単独では証明しません。これらは対応する受入/E2E/運用証拠と照合します。

## 削除した廃止検証

Upstash pingは削除しました。src/lib/redis.tsはMemoryStore、rate limitはPostgresへ移行し、src/packageにUpstash実行依存はありません。外部依存を復活させてpingする目的はなく、必須Supabase17件とは別です。

新しいSaaS依存を導入する場合は、実行先・副作用・credential・必須条件を決めて対応contractを追加します。
