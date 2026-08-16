/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * src/lib/json-value.ts（jsonb 列へ渡す値の正規化）の単体テスト。
 *
 * このヘルパーは監査ログ・webhook キュー・cron ログ・Stripe webhook・A/B テスト・GBP 監査という
 * 【失敗しても画面に何も出ない経路】でだけ使われる。値の作り替えを誤ると、記録された内容が
 * 静かに欠けたり壊れたりして、障害調査のときに初めて気づくことになる。分岐を全て固定する。
 */
import { toJsonValue } from '../json-value';

describe('toJsonValue', () => {
  it('JSON のプリミティブはそのまま返す', () => {
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue('a')).toBe('a');
    expect(toJsonValue(0)).toBe(0);
    expect(toJsonValue(1.5)).toBe(1.5);
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(false)).toBe(false);
  });

  it('配列は要素ごとに再帰変換する', () => {
    expect(toJsonValue([1, 'a', null, [true]])).toEqual([1, 'a', null, [true]]);
  });

  it('オブジェクトは再帰変換し、undefined のプロパティは落とす（JSON.stringify と同じ挙動）', () => {
    const input = { keep: 'x', drop: undefined, nested: { n: 1, alsoDrop: undefined } };
    const out = toJsonValue(input) as Record<string, unknown>;
    expect(out).toEqual({ keep: 'x', nested: { n: 1 } });
    expect(Object.prototype.hasOwnProperty.call(out, 'drop')).toBe(false);
  });

  it('JSON で表現できない値は null に倒す', () => {
    // jsonb 列に入れられる形にするのが目的なので、落とすのではなく null にする。
    expect(toJsonValue(undefined)).toBeNull();
    expect(toJsonValue(() => 1)).toBeNull();
    expect(toJsonValue(Symbol('s'))).toBeNull();
    expect(toJsonValue(10n)).toBeNull();
  });

  it('インデックスシグネチャを持たない値（interface 由来の型）も変換できる', () => {
    // これがこのヘルパーの存在理由。Json へ直接代入できない形の値を受け取れることを固定する。
    interface AuditPayload {
      action: string;
      count: number;
    }
    const payload: AuditPayload = { action: 'update', count: 2 };
    expect(toJsonValue(payload)).toEqual({ action: 'update', count: 2 });
  });

  it('入力を破壊せず、新しい値を返す', () => {
    const input = { a: { b: 1 } };
    const out = toJsonValue(input) as { a: { b: number } };
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(input).toEqual({ a: { b: 1 } });
  });
});
