/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * レスポンス送出後の副作用が「投げっぱなし」にならないことを固定する（2026年8月12日 新設）。
 *
 * 🔴 【背景＝本番の実測】サーバーレスはレスポンスを返した時点でインスタンスを凍結・終了して
 * よいため、`void doSomething()` の完了は保証されない。本番の audit_logs は全期間 5 行しかなく、
 * うち 4 行は DB トリガ由来で、アプリコード（`void writeAuditLog(...)` 83 箇所）由来は 1 行だけだった。
 * Next.js の `after()` に登録すれば「応答後・終了前」の実行をランタイムが保証する。
 */
const mockAfter = jest.fn();

jest.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => mockAfter(task),
}));

import { runAfterResponse } from '../after-response';

beforeEach(() => {
  // clearAllMocks は呼び出し履歴しか消さない。mockImplementation（after() を throw させる
  // ケース）が次のテストへ漏れると、fallback 経路に落ちて挙動が変わるため reset する。
  mockAfter.mockReset();
});

test('after() に登録する（本番のリクエストスコープ内）', async () => {
  const task = jest.fn().mockResolvedValue(undefined);
  await runAfterResponse(task);

  expect(mockAfter).toHaveBeenCalledTimes(1);
  // 登録だけで、この時点では実行しない（応答を遅らせないため）
  expect(task).not.toHaveBeenCalled();

  // ランタイムが後で呼ぶと実行される
  await (mockAfter.mock.calls[0][0] as () => Promise<unknown>)();
  expect(task).toHaveBeenCalledTimes(1);
});

test('after() が throw する文脈（リクエストスコープ外）では自前で実行し、完了を待てる', async () => {
  mockAfter.mockImplementation(() => {
    throw new Error('after() was called outside a request scope');
  });
  const order: string[] = [];
  const task = jest.fn(async () => {
    order.push('task');
  });

  await runAfterResponse(task);

  // 【重要】await した時点で完了していること。void で投げっぱなしにすると
  // 検証がマイクロタスクの順序に依存して不安定になる。
  expect(order).toEqual(['task']);
  expect(task).toHaveBeenCalledTimes(1);
});

test('after() 経路では task が未完了でも呼び出し側は止まらない', async () => {
  // 解決しない Promise を返す task。after() 経路は登録するだけなので、
  // runAfterResponse の await はこれに引きずられない（引きずられるならタイムアウトする）。
  const task = jest.fn(() => new Promise<void>(() => {}));
  await runAfterResponse(task);
  expect(mockAfter).toHaveBeenCalledTimes(1);
  expect(task).not.toHaveBeenCalled();
});
