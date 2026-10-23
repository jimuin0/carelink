/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';
import { loginDestination, landingPathFor, readManagedFacilityName, readStoreAccess,
  POST_LOGIN_LANDING_PATH, STORE_ADMIN_PATH } from '../post-login-landing';

// 戻り先を指定せずにログインした店舗オーナーが、来院者向けの /mypage に固定されていた不具合の回帰テスト。
const ORIGIN = 'https://carelink.test';
type Result = { data: unknown; error: unknown };

function membershipClient(result: Result | (() => never)) {
  const calls: unknown[][] = [];
  const terminal = async () => (typeof result === 'function' ? result() : result);
  const chain = {
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return chain; },
    eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return chain; },
    in: (...args: unknown[]) => { calls.push(['in', ...args]); return chain; },
    order: (...args: unknown[]) => { calls.push(['order', ...args]); return chain; },
    limit: (...args: unknown[]) => { calls.push(['limit', ...args]); return chain; },
    maybeSingle: terminal,
  };
  const client = { from: (table: string) => { calls.push(['from', table]); return chain; } };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe('loginDestination', () => {
  test('戻り先の指定が無ければ着地点の振り分けへ', () => {
    expect(loginDestination(null, ORIGIN)).toBe(POST_LOGIN_LANDING_PATH);
    expect(loginDestination(undefined, ORIGIN)).toBe(POST_LOGIN_LANDING_PATH);
    expect(loginDestination('', ORIGIN)).toBe(POST_LOGIN_LANDING_PATH);
    expect(POST_LOGIN_LANDING_PATH).toBe('/auth/landing');
  });
  test('指定があれば同一オリジンのパスだけ（オープンリダイレクトは従来どおり /mypage）', () => {
    expect(loginDestination('/admin/onboarding?handoff=registration', ORIGIN)).toBe('/admin/onboarding?handoff=registration');
    expect(loginDestination('/\\evil.example', ORIGIN)).toBe('/mypage');
    expect(loginDestination('https://evil.example/', ORIGIN)).toBe('/mypage');
  });
});

describe('readStoreAccess / landingPathFor', () => {
  test('owner/admin の行があれば店舗あり → /admin。役割で絞って 1 行だけ読む', async () => {
    const { client, calls } = membershipClient({ data: { role: 'owner' }, error: null });
    expect(await readStoreAccess(client, 'u1')).toBe('store');
    expect(calls).toEqual([['from', 'facility_members'], ['select', 'role'], ['eq', 'user_id', 'u1'],
      ['in', 'role', ['owner', 'admin']], ['limit', 1]]);
    expect(await landingPathFor(client, 'u1')).toBe(STORE_ADMIN_PATH);
  });
  test('行が無い来院者は /mypage', async () => {
    const { client } = membershipClient({ data: null, error: null });
    expect(await readStoreAccess(client, 'u1')).toBe('none');
    expect(await landingPathFor(client, 'u1')).toBe('/mypage');
  });
  test('取得失敗・例外は否定と区別して unknown（着地は来院者側）', async () => {
    const failed = membershipClient({ data: { role: 'owner' }, error: { message: 'x' } });
    expect(await readStoreAccess(failed.client, 'u1')).toBe('unknown');
    expect(await landingPathFor(failed.client, 'u1')).toBe('/mypage');
    const thrown = membershipClient(() => { throw new Error('network'); });
    expect(await readStoreAccess(thrown.client, 'u1')).toBe('unknown');
  });
});

describe('readManagedFacilityName', () => {
  test('管理できる最初の店舗の名前を返す', async () => {
    const { client, calls } = membershipClient({ data: { facility_profiles: { name: '  合成サロン  ' } }, error: null });
    expect(await readManagedFacilityName(client, 'u1')).toBe('合成サロン');
    expect(calls).toContainEqual(['in', 'role', ['owner', 'admin']]);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: true }]);
  });
  test('名前が空・施設が読めない場合も、管理できる店舗があればカードは出す', async () => {
    expect(await readManagedFacilityName(membershipClient({ data: { facility_profiles: { name: ' ' } }, error: null }).client, 'u1')).toBe('店舗名未設定');
    expect(await readManagedFacilityName(membershipClient({ data: { facility_profiles: null }, error: null }).client, 'u1')).toBe('店舗名未設定');
  });
  test('店舗が無い・取得失敗・例外は null', async () => {
    expect(await readManagedFacilityName(membershipClient({ data: null, error: null }).client, 'u1')).toBeNull();
    expect(await readManagedFacilityName(membershipClient({ data: { facility_profiles: { name: 'x' } }, error: { message: 'x' } }).client, 'u1')).toBeNull();
    expect(await readManagedFacilityName(membershipClient(() => { throw new Error('network'); }).client, 'u1')).toBeNull();
  });
});
