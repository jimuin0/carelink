import { z } from 'zod';

/**
 * zod v4 は z.object を作る時点で `new Function('')` を試し（eval が使えるかの探査）、
 * 使えれば高速版のパーサーを生成する。CareLink の CSP は 'unsafe-eval' を許していないため、
 * この探査が例外として握りつぶされても、ブラウザは CSP 違反として全ページで報告していた。
 *
 * jitless にすると探査そのものをしない（zod 4.4 の util.allowsEval が globalConfig.jitless を
 * 先に見る）。判定はスキーマを作るときに行われるので、どのスキーマよりも先に読み込む必要がある：
 * クライアントは src/instrumentation-client.ts（アプリのコードより先に実行される）、
 * サーバーは src/instrumentation.ts から読み込む。
 */
z.config({ jitless: true });
