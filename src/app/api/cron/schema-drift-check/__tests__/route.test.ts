/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/schema-drift-check — branches 100%。
 *   - cron auth NG / 列RPC error→500 / 列ドリフト有→Slack警告 / ドリフト無→無通知
 *   - 制約RPC error→skip(graceful) / 制約ドリフト有→警告
 *   - 【claim-first・2026-07-17】cron_alert_claims への claim insert で三重化cronの
 *     重複Slack警報を防止。23505=deduped(スキップ)／その他error=fail-open(送信)。
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/schema-drift', () => ({
  computeDrift: jest.fn(),
  computeConstraintDrift: jest.fn(),
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
import { alertWarning } from '@/lib/alert';
import { computeDrift, computeConstraintDrift } from '@/lib/schema-drift';

function req() {
  return new Request('http://localhost/api/cron/schema-drift-check', {
    headers: { authorization: 'Bearer x' },
  });
}

const EMPTY_COL_DRIFT = { contaminated: [], missing: [], colDrift: [] };
const EMPTY_CONSTRAINT_DRIFT = { extra: [], missing: [] };

/** 列RPC(get_public_columns) と 制約RPC(get_public_constraints) を名前で出し分ける。 */
function setRpc(cols: unknown, constraints: unknown) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'get_public_columns' ? cols : constraints),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
  (computeConstraintDrift as jest.Mock).mockReturnValue(EMPTY_CONSTRAINT_DRIFT);
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

test('列ドリフト有(data=配列) + 制約RPC成功・制約ドリフト無 + claim成功 → alert 発火', async () => {
  setRpc(
    { data: [{ table_name: 'evil', column_name: 'x' }], error: null },
    { data: [{ table_name: 't', kind: 'p', columns: 'id' }], error: null },
  );
  (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil'], missing: [], colDrift: [] });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.contaminated).toEqual(['evil']);
  expect(json.constraintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
  // claim insert が (job_name, claim_key) で呼ばれている
  expect(mockClaimInsert).toHaveBeenCalledTimes(1);
  const [table, row] = mockClaimInsert.mock.calls[0];
  expect(table).toBe('cron_alert_claims');
  expect(row.job_name).toBe('schema-drift-check');
  expect(typeof row.claim_key).toBe('string');
  // 古い claim 行の掃除も同 run 内で呼ばれる（job_name を自ジョブに限定＝越境削除しない）
  expect(mockClaimDeleteEq).toHaveBeenCalledTimes(1);
  expect(mockClaimDeleteEq.mock.calls[0]).toEqual(['cron_alert_claims', 'job_name', 'schema-drift-check']);
  expect(mockClaimDeleteLt).toHaveBeenCalledTimes(1);
  expect(mockClaimDeleteLt.mock.calls[0][0]).toBe('cron_alert_claims');
  expect(mockClaimDeleteLt.mock.calls[0][1]).toBe('claimed_at');
  // meta に alertDeduped=false が記録される
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.alertDeduped).toBe(false);
});

test('ドリフト無(列data=null / 制約data=null) → 無通知 + ok（claim insert も呼ばれない）', async () => {
  setRpc({ data: null, error: null }, { data: null, error: null });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.constraintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
  expect(mockClaimInsert).not.toHaveBeenCalled();
  expect(mockClaimDeleteLt).not.toHaveBeenCalled();
});

test('制約RPC エラー → graceful skip（constraintCheckSkipped=true・cron は壊れない）+ 監視無効化を警報', async () => {
  // C-8 根治: 制約RPC失敗は監視そのものが無効化される障害のため、従来の「無音skip」
  // ではなく alertWarning で恒久検知する（列レベルの drift 監視は継続・cron は 'success'）。
  setRpc({ data: [], error: null }, { data: null, error: { message: 'function does not exist' } });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.constraintCheckSkipped).toBe(true);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/制約ドリフト監視が無効化/);
});

test('制約ドリフト有(extra/missing) → driftCount に算入 + claim成功 + alert', async () => {
  setRpc(
    { data: [], error: null },
    { data: [{ table_name: 'review_helpful', kind: 'p', columns: 'review_id,user_id' }], error: null },
  );
  (computeConstraintDrift as jest.Mock).mockReturnValue({
    extra: ['review_helpful:p(review_id,user_id)'],
    missing: ['review_helpful:p(id)'],
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(2);
  expect(json.constraintExtra).toEqual(['review_helpful:p(review_id,user_id)']);
  expect(json.constraintMissing).toEqual(['review_helpful:p(id)']);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
});

describe('claim-first 重複防止（三重化cronの同時発火対策）', () => {
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
    expect((logCronRun as jest.Mock).mock.calls[0][3].meta.alertDeduped).toBe(true);
  });

  test('(c) claim その他error(42P01=テーブル未作成/migration未適用) → fail-open で alertWarning が呼ばれる', async () => {
    setColDrift();
    mockClaimInsert.mockResolvedValue({ error: { code: '42P01', message: 'relation "cron_alert_claims" does not exist' } });
    const res = await GET(req());
    expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((logCronRun as jest.Mock).mock.calls[0][3].meta.alertDeduped).toBe(false);
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

// 【2026年7月29日 追加】business_type の値ドリフト監視。
// business_type は検索・カテゴリ導線・/type/* の結合キーだが DB に CHECK 制約が無く、
// 本番で正規タクソノミー外の値（「まつげ・眉毛サロン」「hair_salon」）が保存された結果、
// 施設は存在するのにトップのカテゴリタイル等が全て0件になり到達不能になっていた。
// 保存の入口は塞いだが、DDL・手動投入で再びズレうるため、ここで検知し続ける。
describe('business_type の値ドリフト監視', () => {
  test('正規タクソノミー外の値を検知して driftCount に加算する', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
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
    expect(alertWarning).toHaveBeenCalled();
  });

  test('全て正規タクソノミー内なら検知しない（誤検知しない）', async () => {
    (computeDrift as jest.Mock).mockReturnValue({ contaminated: [], missing: [], colDrift: [] });
    (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
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
    (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
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
    (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
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
    (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
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
  (computeConstraintDrift as jest.Mock).mockReturnValue({ extra: [], missing: [] });
  mockBusinessTypeSelect.mockResolvedValueOnce({ data: null, error: null });

  const res = await GET(req());
  const json = await res.json();

  expect(res.status).toBe(200);
  expect(json.businessTypeDrift).toEqual([]);
});

/**
 * 【口コミ真正性の値監視・2026年7月29日】
 * 本番 facility_reviews に、サイト経由でない口コミ13件が一括 INSERT され、
 * 公開ページに ★4.6〜4.8 として表示されていた（うち3件は裏付けの無い「来店確認済み」）。
 * 入口は CHECK 制約（20260729000002）で塞ぐが、制約が外された場合・DDL 未適用の環境で
 * 無音にならないよう、値としても見張る。その分岐をここで固定する。
 */
describe('口コミ真正性の値監視', () => {
  beforeEach(() => {
    setRpc({ data: [], error: null }, { data: [], error: null });
    (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
    (computeConstraintDrift as jest.Mock).mockReturnValue(EMPTY_CONSTRAINT_DRIFT);
  });

  test('両方0件 → ドリフト無し・通知なし', async () => {
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([]);
    expect(json.driftCount).toBe(0);
    expect(alertWarning).not.toHaveBeenCalled();
  });

  test('reviewer_ip 欠落あり → ドリフト検知して通知', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: 13, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual(['reviewer_ip欠落:13件']);
    expect(json.driftCount).toBe(1);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('口コミ真正性1'),
      expect.anything(),
    );
  });

  test('来店確認済みだが user_id 無し → ドリフト検知', async () => {
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: 3, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual(['来店確認済みだがuser_id無し:3件']);
    expect(json.driftCount).toBe(1);
  });

  test('両方該当 → 2件とも報告する（片方で止めない）', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: 13, error: null });
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: 3, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([
      'reviewer_ip欠落:13件',
      '来店確認済みだがuser_id無し:3件',
    ]);
    expect(json.driftCount).toBe(2);
  });

  // count が null（PostgREST が件数を返さない場合）で NaN や誤検知にならないこと。
  test('count が null なら 0 件扱い', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: null, error: null });
    mockReviewUnbackedCount.mockResolvedValueOnce({ count: null, error: null });
    const json = await (await GET(req())).json();
    expect(json.reviewAuthenticityDrift).toEqual([]);
  });

  // 監視が壊れても cron 本体は止めない（列・制約の監視は継続させる）。
  test('取得失敗時は警告を出しつつ本体は success', async () => {
    mockReviewIplessCount.mockResolvedValueOnce({ count: null, error: { message: 'boom' } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('口コミ真正性の取得失敗'),
      expect.anything(),
    );
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
