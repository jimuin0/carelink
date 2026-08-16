/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/schema-drift-check — branches 100%。
 *   - cron auth NG / 列RPC error→500 / 列ドリフト有→Slack警告 / ドリフト無→無通知
 *   - 制約RPC error→skip(graceful) / 制約ドリフト有→警告
 *   - 【claim-first・2026-07-17】cron_alert_claims への claim insert で三重化cronの
 *     重複Slack警報を防止。23505=deduped(スキップ)／その他error=fail-open(送信)。
 *   - 【severity 分割・2026-08-10・Pillar 2】driftMissing(diffFingerprint)/missing(computeDrift)/
 *     reviewAuthenticityDrift = 🔴 critical(alertError)。contaminated/colDrift/driftExtra/
 *     businessTypeDrift = 🟡 warning(alertWarning)。両者は claim_key に severity を含めて
 *     互いに独立して claim-first dedup される。differentDatabase/versionMismatch/vacuous/
 *     fingerprintCheckSkipped の既存 graceful-skip 経路は 🔴 を一切発火しないことを固定する。
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn(), alertError: jest.fn() }));
jest.mock('@/lib/schema-drift', () => ({
  computeDrift: jest.fn(),
  // 2026年8月2日: 手管理スナップショット方式(computeConstraintDrift)を廃止し、
  // migration から導出した期待フィンガープリントとの突合に置き換えた。
  diffFingerprint: jest.fn(),
}));

const mockRpc = jest.fn();
const mockClaimInsert = jest.fn();
// facility_profiles.select('business_type') の戻り。既定は正規タクソノミー内の値のみ。
const mockBusinessTypeSelect = jest.fn(() =>
  Promise.resolve({ data: [{ business_type: 'ネイル・まつげサロン' }], error: null }),
);
const mockClaimDeleteEq = jest.fn();
const mockClaimDeleteLt = jest.fn();
// 口コミ真正性監視（facility_reviews の count クエリ2本）。既定は 0 件＝ドリフト無しで、
// 既存テストの期待（driftCount / 通知内容）に影響しない。
const mockReviewIplessCount = jest.fn(() => Promise.resolve({ count: 0, error: null }));
const mockReviewUnbackedCount = jest.fn(() => Promise.resolve({ count: 0, error: null }));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({
    rpc: mockRpc,
    from: (table: string) => ({
      // business_type の値ドリフト監視（facility_profiles.select('business_type').range(...)）。
      // fetchAllPaged 経由で .range(offset, limit) まで chain されるため range() を挟む。
      // 既定は正規タクソノミー内の値のみ＝ドリフト0件で、既存テストの期待に影響しない。
      // facility_reviews は count クエリで、
      //   .select(...).is('reviewer_ip', null)                      … サイト外投入
      //   .select(...).eq('is_verified_visit', true).is('user_id', null) … 裏付け無し来店確認済み
      // の2形の chain を張るため、テーブル名で返す chain を切り替える。
      select: () =>
        table === 'facility_reviews'
          ? {
              is: () => mockReviewIplessCount(),
              eq: () => ({ is: () => mockReviewUnbackedCount() }),
            }
          : { range: () => mockBusinessTypeSelect(table) },
      insert: (row: unknown) => mockClaimInsert(table, row),
      // 掃除 delete は .eq('job_name', 自ジョブ) → .lt('claimed_at', ...) の chain
      //（job_name 限定＝他 cron の claim 行を越境削除しない）
      delete: () => ({
        eq: (eqCol: string, eqVal: string) => {
          mockClaimDeleteEq(table, eqCol, eqVal);
          return {
            lt: (col: string, val: string) => mockClaimDeleteLt(table, col, val),
          };
        },
      }),
    }),
  }),
}));

import { GET } from '../route';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning, alertError } from '@/lib/alert';
import { computeDrift, diffFingerprint } from '@/lib/schema-drift';

function req() {
  return new Request('http://localhost/api/cron/schema-drift-check', {
    headers: { authorization: 'Bearer x' },
  });
}

const EMPTY_COL_DRIFT = { contaminated: [], missing: [], colDrift: [] };
const EMPTY_FINGERPRINT_DRIFT = { extra: [], missing: [], vacuous: false };

/** 列RPC(get_public_columns) と フィンガープリントRPC(get_schema_fingerprint) を名前で出し分ける。 */
function setRpc(cols: unknown, fingerprint: unknown) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'get_public_columns' ? cols : fingerprint),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
  (diffFingerprint as jest.Mock).mockReturnValue(EMPTY_FINGERPRINT_DRIFT);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  // デフォルト: claim insert 成功・cleanup delete 成功（fail-open/deduped の各テストで上書きする）
  mockClaimInsert.mockResolvedValue({ error: null });
  mockClaimDeleteLt.mockResolvedValue({ error: null });
  // jest.clearAllMocks() は calls を消すだけで mockImplementation() を戻さない。
  // maxRows テストが 100000 件を返す実装を差し込むため、明示的に既定へ戻さないと
  // 後続テストがその実装を引き継ぎ、テスト順序に依存した偽の失敗/成功が起きる。
  mockBusinessTypeSelect.mockImplementation(() =>
    Promise.resolve({ data: [{ business_type: 'ネイル・まつげサロン' }], error: null }),
  );
  mockReviewIplessCount.mockImplementation(() => Promise.resolve({ count: 0, error: null }));
  mockReviewUnbackedCount.mockImplementation(() => Promise.resolve({ count: 0, error: null }));
});

test('cron auth NG → そのレスポンス', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  );
  expect((await GET(req())).status).toBe(401);
});

test('列RPC エラー → 500 + logCronRun(error)（制約RPCに到達しない）', async () => {
  setRpc({ data: null, error: { message: 'rpc fail' } }, { data: [], error: null });
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
});

test('列ドリフト有(contaminated, 🟡専用) + 制約RPC成功・制約ドリフト無 + claim成功 → alertWarning のみ発火（alertError は呼ばれない）', async () => {
  setRpc(
    { data: [{ table_name: 'evil', column_name: 'x' }], error: null },
    { data: [{ table_name: 't', kind: 'p', columns: 'id' }], error: null },
  );
  (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil'], missing: [], colDrift: [] });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.criticalCount).toBe(0);
  expect(json.warningCount).toBe(1);
  expect(json.contaminated).toEqual(['evil']);
  expect(json.fingerprintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
  // claim insert が (job_name, claim_key) で呼ばれている。severity=warning が claim_key に埋め込まれる
  expect(mockClaimInsert).toHaveBeenCalledTimes(1);
  const [table, row] = mockClaimInsert.mock.calls[0];
  expect(table).toBe('cron_alert_claims');
  expect(row.job_name).toBe('schema-drift-check');
  expect(typeof row.claim_key).toBe('string');
  expect(row.claim_key).toMatch(/:warning:/);
  // 古い claim 行の掃除も同 run 内で呼ばれる（job_name を自ジョブに限定＝越境削除しない）
  expect(mockClaimDeleteEq).toHaveBeenCalledTimes(1);
  expect(mockClaimDeleteEq.mock.calls[0]).toEqual(['cron_alert_claims', 'job_name', 'schema-drift-check']);
  expect(mockClaimDeleteLt).toHaveBeenCalledTimes(1);
  expect(mockClaimDeleteLt.mock.calls[0][0]).toBe('cron_alert_claims');
  expect(mockClaimDeleteLt.mock.calls[0][1]).toBe('claimed_at');
  // meta に severity別 deduped と後方互換の alertDeduped が記録される
  const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
  expect(meta.criticalDeduped).toBe(false);
  expect(meta.warningDeduped).toBe(false);
  expect(meta.alertDeduped).toBe(false);
});

test('ドリフト無(列data=null / 制約data=null) → 無通知 + ok（claim insert も呼ばれない）', async () => {
  setRpc({ data: null, error: null }, { data: null, error: null });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.criticalCount).toBe(0);
  expect(json.warningCount).toBe(0);
  expect(json.fingerprintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
  expect(mockClaimInsert).not.toHaveBeenCalled();
  expect(mockClaimDeleteLt).not.toHaveBeenCalled();
});

test('フィンガープリントRPC エラー → graceful skip（cron は壊れない）+ 監視無効化を警報（🔴は発火しない）', async () => {
  // 監視そのものが無効化される障害は「無音skip」にしない。無音にすると
  // 「緑＝正常」と読み替えられ、監視が死んだまま気づけなくなる。
  // ただし監視の設定不備自体は本番の異常ではないため 🟡 のまま（🔴 に昇格させない）。
  setRpc({ data: [], error: null }, { data: null, error: { message: 'function does not exist' } });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.fingerprintCheckSkipped).toBe(true);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/スキーマ全面監視が無効化/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

test('missing(computeDrift, 期待テーブルが本番に無い) → 🔴 critical(alertError) のみ発火', async () => {
  setRpc({ data: [], error: null }, { data: [], error: null });
  (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: ['facility_profiles'], colDrift: [] });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.criticalCount).toBe(1);
  expect(json.warningCount).toBe(0);
  expect(alertError as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertError as jest.Mock).mock.calls[0][0]).toMatch(
    /本番が migration より古い（未適用migrationの疑い）= 本番に無い定義: 0件 \/ 期待テーブル欠落: 1件/,
  );
  expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
});

test('colDrift(computeDrift, 列差分) → 🟡 warning のみ発火', async () => {
  setRpc({ data: [], error: null }, { data: [], error: null });
  (computeDrift as jest.Mock).mockReturnValue({
    contaminated: [],
    missing: [],
    colDrift: ['facility_profiles(+extra_col/-)'],
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.criticalCount).toBe(0);
  expect(json.warningCount).toBe(1);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

test('スキーマドリフト有(driftExtra🟡 + driftMissing🔴) → driftCount に算入 + 両severity claim成功 + alertError と alertWarning が両方発火', async () => {
  setRpc({ data: [], error: null }, { data: ['x'], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({
    extra: ['index|foo|idx_x|CREATE INDEX idx_x ON public.foo USING btree (a)'],
    missing: ['policy|bar|p_read|cmd=r|permissive=PERMISSIVE|roles=PUBLIC|using=(true)|check='],
    vacuous: false,
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(2);
  expect(json.criticalCount).toBe(1);
  expect(json.warningCount).toBe(1);
  expect(json.driftExtra).toEqual([
    'index|foo|idx_x|CREATE INDEX idx_x ON public.foo USING btree (a)',
  ]);
  expect(json.driftMissing).toEqual([
    'policy|bar|p_read|cmd=r|permissive=PERMISSIVE|roles=PUBLIC|using=(true)|check=',
  ]);
  // 🔴 (driftMissing) と 🟡 (driftExtra) が両方1回ずつ独立して発火する
  expect(alertError as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertError as jest.Mock).mock.calls[0][0]).toMatch(
    /本番が migration より古い（未適用migrationの疑い）= 本番に無い定義: 1件/,
  );
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  // claim は severity ごとに独立して2回 insert される（別 claim_key）
  expect(mockClaimInsert).toHaveBeenCalledTimes(2);
  const keys = mockClaimInsert.mock.calls.map(([, row]: [string, { claim_key: string }]) => row.claim_key);
  expect(keys.some((k: string) => k.includes(':critical:'))).toBe(true);
  expect(keys.some((k: string) => k.includes(':warning:'))).toBe(true);
  expect(keys[0]).not.toBe(keys[1]);
});

test('🔴 走査が空振り(vacuous) → ドリフト0件を「一致」と報告せず、監視無効化として警報する（🔴は発火しない）', async () => {
  // 0 件同士の一致は「スキーマが正しい」ではなく「測れていない」。
  // ここを緑にすると、RPC が空を返すようになった瞬間に監視が無音で死ぬ。
  setRpc({ data: [], error: null }, { data: [], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [], vacuous: true });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.fingerprintCheckSkipped).toBe(true);
  expect(json.driftExtra).toEqual([]);
  expect(json.driftMissing).toEqual([]);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/走査が空振り/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

describe('claim-first 重複防止（🟡 warning severity・三重化cronの同時発火対策）', () => {
  function setColDrift() {
    setRpc(
      { data: [{ table_name: 'evil', column_name: 'x' }], error: null },
      { data: [], error: null },
    );
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil'], missing: [], colDrift: [] });
  }

  test('(a) claim成功(error=null) → alertWarning が呼ばれる', async () => {
    setColDrift();
    mockClaimInsert.mockResolvedValue({ error: null });
    await GET(req());
    expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  });

  test('(b) claim 23505(他run先取り済み) → alertWarning は呼ばれない(deduped)', async () => {
    setColDrift();
    mockClaimInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const res = await GET(req());
    expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
    expect(meta.warningDeduped).toBe(true);
    expect(meta.criticalDeduped).toBe(false);
    expect(meta.alertDeduped).toBe(true);
  });

  test('(c) claim その他error(42P01=テーブル未作成/migration未適用) → fail-open で alertWarning が呼ばれる', async () => {
    setColDrift();
    mockClaimInsert.mockResolvedValue({ error: { code: '42P01', message: 'relation "cron_alert_claims" does not exist' } });
    const res = await GET(req());
    expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((logCronRun as jest.Mock).mock.calls[0][3].meta.warningDeduped).toBe(false);
  });

  test('(d) 古いclaim行の掃除deleteが呼ばれる・delete失敗でも本体は200のまま', async () => {
    setColDrift();
    mockClaimDeleteLt.mockResolvedValue({ error: { code: 'XX000', message: 'cleanup failed' } });
    const res = await GET(req());
    expect(mockClaimDeleteLt).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
    expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
  });

  test('(e) claim_key は同一driftなら安定し、drift内容が変わるとキーが変わる', async () => {
    setColDrift();
    await GET(req());
    const firstKey = mockClaimInsert.mock.calls[0][1].claim_key;

    mockClaimInsert.mockClear();
    // 同一drift内容で再実行 → 同じ claim_key
    await GET(req());
    const secondKey = mockClaimInsert.mock.calls[0][1].claim_key;
    expect(secondKey).toBe(firstKey);

    mockClaimInsert.mockClear();
    // drift内容を変える → claim_key が変わる
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil', 'evil2'], missing: [], colDrift: [] });
    await GET(req());
    const thirdKey = mockClaimInsert.mock.calls[0][1].claim_key;
    expect(thirdKey).not.toBe(firstKey);
  });
});

describe('claim-first 重複防止（🔴 critical severity）', () => {
  function setCriticalDrift() {
    setRpc({ data: [], error: null }, { data: ['x'], error: null });
    (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: ['policy|x'], vacuous: false });
  }

  test('claim成功(error=null) → alertError が呼ばれ、alertWarning は呼ばれない', async () => {
    setCriticalDrift();
    mockClaimInsert.mockResolvedValue({ error: null });
    await GET(req());
    expect(alertError as jest.Mock).toHaveBeenCalledTimes(1);
    expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
  });

  test('claim 23505(他run先取り済み) → alertError は呼ばれない(deduped)', async () => {
    setCriticalDrift();
    mockClaimInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const res = await GET(req());
    expect(alertError as jest.Mock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
    expect(meta.criticalDeduped).toBe(true);
    expect(meta.warningDeduped).toBe(false);
    expect(meta.alertDeduped).toBe(true);
  });

  test('claim その他error(42P01=migration未適用) → fail-open で alertError が呼ばれる', async () => {
    setCriticalDrift();
    mockClaimInsert.mockResolvedValue({ error: { code: '42P01', message: 'relation "cron_alert_claims" does not exist' } });
    const res = await GET(req());
    expect(alertError as jest.Mock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((logCronRun as jest.Mock).mock.calls[0][3].meta.criticalDeduped).toBe(false);
  });
});

describe('claim-first: 🔴 と 🟡 は互いに独立して dedup される（同一run内で両方発生）', () => {
  function setBothDrift() {
    setRpc(
      { data: [{ table_name: 'evil', column_name: 'x' }], error: null },
      { data: ['x'], error: null },
    );
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil'], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: ['policy|x'], vacuous: false });
  }

  test('🔴 のclaimだけ他runに先取りされていても 🟡 は送信される', async () => {
    setBothDrift();
    mockClaimInsert.mockImplementation((_table: string, row: { claim_key: string }) =>
      Promise.resolve(
        row.claim_key.includes(':critical:')
          ? { error: { code: '23505', message: 'duplicate key' } }
          : { error: null },
      ),
    );
    const res = await GET(req());
    expect(alertError as jest.Mock).not.toHaveBeenCalled();
    expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
    const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
    expect(meta.criticalDeduped).toBe(true);
    expect(meta.warningDeduped).toBe(false);
    expect(meta.alertDeduped).toBe(true); // どちらかがdedupされていればtrue（後方互換フィールド）
    expect(res.status).toBe(200);
  });

  test('🟡 のclaimだけ他runに先取りされていても 🔴 は送信される', async () => {
    setBothDrift();
    mockClaimInsert.mockImplementation((_table: string, row: { claim_key: string }) =>
      Promise.resolve(
        row.claim_key.includes(':warning:')
          ? { error: { code: '23505', message: 'duplicate key' } }
          : { error: null },
      ),
    );
    const res = await GET(req());
    expect(alertError as jest.Mock).toHaveBeenCalledTimes(1);
    expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
    const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
    expect(meta.criticalDeduped).toBe(false);
    expect(meta.warningDeduped).toBe(true);
    expect(meta.alertDeduped).toBe(true);
    expect(res.status).toBe(200);
  });
});

// 【2026年7月29日 追加】business_type の値ドリフト監視（🟡 warning 側）。
// business_type は検索・カテゴリ導線・/type/* の結合キーだが DB に CHECK 制約が無く、
// 本番で正規タクソノミー外の値（「まつげ・眉毛サロン」「hair_salon」）が保存された結果、
// 施設は存在するのにトップのカテゴリタイル等が全て0件になり到達不能になっていた。
// 保存の入口は塞いだが、DDL・手動投入で再びズレうるため、ここで検知し続ける。
describe('business_type の値ドリフト監視', () => {
  test('正規タクソノミー外の値を検知して driftCount(warningCount) に加算する（alertErrorは呼ばれない）', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
    mockBusinessTypeSelect.mockResolvedValueOnce({
      data: [
        { business_type: 'ネイル・まつげサロン' }, // 正規（検知しない）
        { business_type: 'まつげ・眉毛サロン' },   // ドリフト
        { business_type: 'hair_salon' },           // ドリフト
      ],
      error: null,
    });

    const res = await GET(req());
    const json = await res.json();

    expect(json.businessTypeDrift).toEqual(
      expect.arrayContaining(['まつげ・眉毛サロン', 'hair_salon']),
    );
    expect(json.businessTypeDrift).not.toContain('ネイル・まつげサロン');
    expect(json.driftCount).toBe(2);
    expect(json.criticalCount).toBe(0);
    expect(json.warningCount).toBe(2);
    expect(alertWarning).toHaveBeenCalled();
    expect(alertError).not.toHaveBeenCalled();
  });

  test('全て正規タクソノミー内なら検知しない（誤検知しない）', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
    mockBusinessTypeSelect.mockResolvedValueOnce({
      data: [{ business_type: '鍼灸院・整骨院' }, { business_type: 'ヘアサロン' }],
      error: null,
    });

    const res = await GET(req());
    const json = await res.json();

    expect(json.businessTypeDrift).toEqual([]);
    expect(json.driftCount).toBe(0);
  });

  test('null の business_type は検知対象外（未設定を異常扱いしない）', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
    mockBusinessTypeSelect.mockResolvedValueOnce({
      data: [{ business_type: null }, { business_type: 'ヘアサロン' }],
      error: null,
    });

    const res = await GET(req());
    const json = await res.json();

    expect(json.businessTypeDrift).toEqual([]);
  });

  // fetchAllPaged が maxRows(既定100000) 上限で打ち切られた場合。ページが常に満杯(pageSize=1000)
  // であり続けるモックで100回転させ、truncated=true を発生させる。
  test('facility_profiles が maxRows 上限で打ち切られた場合、打ち切り自体を警報する', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
    const fullPage = Array.from({ length: 1000 }, () => ({ business_type: 'ヘアサロン' }));
    mockBusinessTypeSelect.mockImplementation(() => Promise.resolve({ data: fullPage, error: null }));

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('maxRows 上限で打ち切られた'),
      expect.anything(),
    );
  });

  // 監視自体が壊れても cron 本体は止めない（列・制約の監視は継続させる）。
  test('取得失敗時は警告を出しつつ本体は success を返す', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
    mockBusinessTypeSelect.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('business_type 取得失敗'),
      expect.anything(),
    );
  });
});

// data も error も null（施設0件などで PostgREST が data:null を返す）ケース。
// ここで落ちると監視ごと止まるため、空配列として扱えることを固定する。
test('business_type: data が null でも空配列として扱う', async () => {
  (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
  (diffFingerprint as jest.Mock).mockReturnValue({ extra: [], missing: [] });
  mockBusinessTypeSelect.mockResolvedValueOnce({ data: null, error: null });

  const res = await GET(req());
  const json = await res.json();

  expect(res.status).toBe(200);
  expect(json.businessTypeDrift).toEqual([]);
});

/**
 * 【口コミ真正性の値監視・2026年7月29日、severity=🔴 critical(2026年8月10日)】
 * 本番 facility_reviews に、サイト経由でない口コミ13件が一括 INSERT され、
 * 公開ページに ★4.6〜4.8 として表示されていた（うち3件は裏付けの無い「来店確認済み」）。
 * 入口は CHECK 制約（20260729000002）で塞ぐが、制約が外された場合・DDL 未適用の環境で
 * 無音にならないよう、値としても見張る。fake-review/PII混入の疑いのため 🔴 critical。
 */
describe('口コミ真正性の値監視', () => {
  beforeEach(() => {
    setRpc({ data: [], error: null }, { data: [], error: null });
    (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
    (diffFingerprint as jest.Mock).mockReturnValue(EMPTY_FINGERPRINT_DRIFT);
  });

  test('両方0件 → ドリフト無し・通知なし', async () => {
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([]);
    expect(json.driftCount).toBe(0);
    expect(alertWarning).not.toHaveBeenCalled();
    expect(alertError).not.toHaveBeenCalled();
  });

  test('reviewer_ip 欠落あり → 🔴 critical(alertError) で通知', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: 13, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual(['reviewer_ip欠落:13件']);
    expect(json.driftCount).toBe(1);
    expect(json.criticalCount).toBe(1);
    expect(json.warningCount).toBe(0);
    expect(alertError).toHaveBeenCalledTimes(1);
    expect((alertError as jest.Mock).mock.calls[0][0]).toMatch(/口コミ真正性ドリフト: 1件/);
    expect(alertWarning).not.toHaveBeenCalled();
  });

  test('来店確認済みだが user_id 無し → 🔴 critical(alertError) で通知', async () => {
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: 3, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual(['来店確認済みだがuser_id無し:3件']);
    expect(json.driftCount).toBe(1);
    expect(json.criticalCount).toBe(1);
    expect(alertError).toHaveBeenCalledTimes(1);
  });

  test('両方該当 → 2件とも報告する（片方で止めない）+ alertError 1回', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: 13, error: null });
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: 3, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([
      'reviewer_ip欠落:13件',
      '来店確認済みだがuser_id無し:3件',
    ]);
    expect(json.driftCount).toBe(2);
    expect(json.criticalCount).toBe(2);
    expect(alertError).toHaveBeenCalledTimes(1);
  });

  // count が null（PostgREST が件数を返さない場合）で NaN や誤検知にならないこと。
  test('count が null なら 0 件扱い', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: null, error: null });
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: null, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([]);
  });

  // 監視が壊れても cron 本体は止めない（列・制約の監視は継続させる）。
  test('取得失敗時は警告を出しつつ本体は success（alertWarningのまま・alertErrorには昇格しない）', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: null, error: { message: 'boom' } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('口コミ真正性の取得失敗'),
      expect.anything(),
    );
    expect(alertError).not.toHaveBeenCalled();
    expect((await res.json()).reviewAuthenticityDrift).toEqual([]);
  });

  test('2本目だけ失敗しても警告する（片方成功で握り潰さない）', async () => {
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: null, error: { message: 'boom2' } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('口コミ真正性の取得失敗'),
      expect.anything(),
    );
  });
});

test('🔴 別DBと突合している疑い → 差分0件で「監視が成立していない」として警報する（criticalは発火しない）', async () => {
  // 2026年8月2日に実際にやりかけた事故: CareLink の期待値を soel の本番と突合して
  // 「RLS が 90 本欠落」という存在しない事故を報告しかけた。
  // 別 DB の差分を driftExtra/driftMissing に載せてはいけない。この graceful-skip 経路は
  // 「監視が成立していない」設定不備であり、本番の異常ではないため 🔴(alertError) には昇格しない。
  setRpc({ data: [], error: null }, { data: ['x'], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({
    extra: [], missing: [], vacuous: false,
    differentDatabase: { overlap: 0, sharedRelations: 0, expectedRelations: 98, actualRelations: 56 },
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.fingerprintCheckSkipped).toBe(true);
  expect(json.driftExtra).toEqual([]);
  expect(json.driftMissing).toEqual([]);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/別のデータベース/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

test('🔴 メジャーバージョン不一致 → 差分0件で「突合が成立していない」として警報する（criticalは発火しない）', async () => {
  // pg_get_* の整形はメジャー間で変わり得るため、この状態の差分は本番のドリフトではなく
  // 整形差のノイズ。数百件を「ドリフト」として報告すると存在しない事故の報告になる。
  // 突合不成立の設定不備であり本番の異常ではないため 🔴(alertError) には昇格しない。
  setRpc({ data: [], error: null }, { data: ['x'], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({
    extra: ['noise|1'], missing: ['noise|2'], vacuous: false,
    versionMismatch: { expected: '17', actual: '16' },
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.fingerprintCheckSkipped).toBe(true);
  expect(json.driftExtra).toEqual([]);
  expect(json.driftMissing).toEqual([]);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/メジャーバージョン不一致/);
  // 実測値が通知に載ること（これを見て CI の image を直す運用が成立する条件）。
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/期待値=17 \/ 本番=16/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

test('メジャーバージョンが片側だけ取れないときも「不明」と明示して警報する（criticalは発火しない）', async () => {
  setRpc({ data: [], error: null }, { data: ['x'], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({
    extra: [], missing: [], vacuous: false,
    versionMismatch: { expected: '17', actual: null },
  });
  const res = await GET(req());
  expect((await res.json()).fingerprintCheckSkipped).toBe(true);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/期待値=17 \/ 本番=不明/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

test('メジャーバージョンが期待値側だけ取れないときも「不明」と明示して警報する（criticalは発火しない）', async () => {
  setRpc({ data: [], error: null }, { data: ['x'], error: null });
  (diffFingerprint as jest.Mock).mockReturnValue({
    extra: [], missing: [], vacuous: false,
    versionMismatch: { expected: null, actual: '16' },
  });
  const res = await GET(req());
  expect((await res.json()).fingerprintCheckSkipped).toBe(true);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/期待値=不明 \/ 本番=16/);
  expect(alertError as jest.Mock).not.toHaveBeenCalled();
});

// ── toSchemaRow（get_public_columns の各要素を実行時検証して詰め替える内部関数）──
// 関数自体は export されていないため、GET 経由で RPC の戻り値配列に想定外の形を
// 混入させ、computeDrift へ実際に渡される rows（= toSchemaRow の適用結果を
// null 除去した配列）を検証することで、想定形の検証ロジックが正しく動くことを確認する。
test('toSchemaRow：想定外の形（非object/null/配列/table_name型不一致/column_name型不一致）は全て弾き、想定形の要素だけを SchemaRow として computeDrift に渡す', async () => {
  setRpc(
    {
      data: [
        'invalid-string', // typeof v !== 'object' → null
        null, // v === null → null
        ['nested', 'array'], // Array.isArray(v) → null
        { table_name: 123, column_name: 'col' }, // table_name が string でない → null
        { table_name: 'tbl', column_name: 456 }, // column_name が string でない → null
        { table_name: 'facility_profiles', column_name: 'id' }, // 想定形 → SchemaRow として通す
      ],
      error: null,
    },
    { data: [], error: null },
  );
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(computeDrift as jest.Mock).toHaveBeenCalledTimes(1);
  // computeDrift(expected, rows) の第2引数が toSchemaRow 適用後の rows
  const rowsArg = (computeDrift as jest.Mock).mock.calls[0][1];
  expect(rowsArg).toEqual([{ table_name: 'facility_profiles', column_name: 'id' }]);
});
