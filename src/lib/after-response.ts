/**
 * レスポンス送出後に実行したい副作用（監査ログ・Slack 通知等）を、
 * 実行完了が保証される形で登録する（2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か＝本番で起きている実害】これまでは `void doSomething()` と浮いた Promise を
 * 投げっぱなしにしていた。サーバーレス（Vercel）は【レスポンスを返した時点でインスタンスを
 * 凍結・終了してよい】ため、その後に走るはずだった非同期処理は完了が保証されない。
 * 本番の `audit_logs` は全期間で 5 行しかなく、うち 4 行は DB トリガ由来
 * （`20260524000001_audit_signup_salon.sql` の `auth.users` AFTER INSERT）で、
 * アプリコード（`void writeAuditLog(...)` 83 箇所）由来は 1 行だけだった。
 * 同じ形の `alertCaughtError`（120 箇所・`withRoute` の catch を含む＝全 500 の Slack 通知）も
 * 同じ理由で取りこぼしうる。
 *
 * 【なぜ await ではなく after() なのか】await にすると監査ログや通知の遅延がそのまま
 * 利用者の応答時間になり、失敗すれば本体まで巻き込みかねない。Next.js の `after()` は
 * 「レスポンス送出後・インスタンス終了前」に実行することをランタイムに約束させる仕組みで、
 * 応答を遅らせずに完了だけを保証できる（Next 15.1+ で安定）。
 *
 * 【フォールバック】`after()` はリクエストスコープの外（スクリプト実行・単体テスト等）では
 * throw する。その場合は従来どおり浮いた Promise として実行する。呼び出し側から見て
 * 「本体を止めない」という契約は、どちらの経路でも変わらない。
 *
 * ⚠️ `task` は自分で例外を処理すること。この関数は登録するだけで、失敗を報告しない
 * （報告経路自体がこの仕組みに依存しており、ここで投げると本体を巻き込むため）。
 *
 * ⚠️ `next/server` は【遅延読み込み】する。モジュール先頭で import すると、Request 実装を
 * 持たない jsdom 環境の単体テストが import しただけで落ちる（audit-logger は 83 経路から
 * 参照されるため、影響範囲が全テストに及ぶ）。
 */
export function runAfterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require('next/server') as {
      after: (t: () => Promise<unknown>) => void;
    };
    after(task);
    // 登録できた時点で呼び出し側は待たなくてよい（応答を遅らせない）。
    return Promise.resolve();
  } catch {
    // リクエストスコープ外、または next/server を解決できない実行文脈。
    // ここでは task の完了を返す。返り値を await できる形にしておくと、
    // スクリプトや単体テストが「実行されたこと」を決定的に検証できる
    // （void で投げっぱなしにすると、検証がマイクロタスクの順序に依存して不安定になる）。
    return task().then(() => undefined);
  }
}
