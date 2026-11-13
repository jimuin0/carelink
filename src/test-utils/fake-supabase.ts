/**
 * テスト用の最小の Supabase クライアント（service role 相当）。
 * from(table) からの呼び出しを 1 件ずつ記録し、結果は handler（テストごとに差し替え）が決める。
 * 返り値の形は supabase-js と同じ { data, error }。チェーンは thenable と single / maybeSingle で終わる。
 */
export type FakeCall = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: unknown;
  options?: unknown;
  filters: Array<[string, string, unknown]>;
  returning: boolean;
};
export type FakeResult = { data?: unknown; error?: unknown };
export type FakeHandler = (call: FakeCall) => FakeResult | undefined;

export function createFakeSupabase(handler: FakeHandler) {
  const calls: FakeCall[] = [];
  const result = (call: FakeCall) => {
    const r = handler(call) ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  };
  const client = {
    from(table: string) {
      const call: FakeCall = { table, op: 'select', filters: [], returning: false };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => { if (call.op !== 'select') call.returning = true; return builder; },
        insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return builder; },
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return builder; },
        upsert: (payload: unknown, options?: unknown) => { call.op = 'upsert'; call.payload = payload; call.options = options; return builder; },
        delete: () => { call.op = 'delete'; return builder; },
        eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return builder; },
        in: (k: string, v: unknown) => { call.filters.push(['in', k, v]); return builder; },
        order: () => builder,
        single: () => Promise.resolve(result(call)),
        maybeSingle: () => Promise.resolve(result(call)),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result(call)).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client, calls };
}

/** filters の eq 値を取り出す。 */
export const eqOf = (call: FakeCall, key: string) => call.filters.find(([op, k]) => op === 'eq' && k === key)?.[2];
