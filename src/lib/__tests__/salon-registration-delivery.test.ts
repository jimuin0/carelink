import { readSalonRegistrationResult, settleSalonUploads } from '../salon-registration-delivery';

const id = '11111111-1111-1111-1111-111111111111';
const response = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

test('全uploadを待ち入力順を保つ（空配列も可）', async () => {
  let resolveFirst!: (value: string) => void;
  const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
  const pending = settleSalonUploads([first, Promise.resolve('second')]);
  resolveFirst('first');
  await expect(pending).resolves.toEqual(['first', 'second']);
  await expect(settleSalonUploads([])).resolves.toEqual([]);
});

test('早期失敗でも遅延upload完了まではrejectせずcleanupの競合を防ぐ', async () => {
  let resolveLate!: (value: string) => void;
  const late = new Promise<string>((resolve) => { resolveLate = resolve; });
  const error = new Error('fixture failure');
  const rejected = jest.fn();
  const pending = settleSalonUploads([Promise.reject(error), late]).catch(rejected);
  await Promise.resolve();
  await Promise.resolve();
  expect(rejected).not.toHaveBeenCalled();
  resolveLate('late');
  await pending;
  expect(rejected).toHaveBeenCalledWith(error);
});

test('success=trueと妥当なUUIDを持つ2xxのみ確認済み成功', async () => {
  await expect(readSalonRegistrationResult(response(200, { success: true, id }))).resolves.toEqual({ kind: 'confirmed', id });
});

test.each([400, 403, 429])('保存前拒否%sは元の文言を保持し再試行可能', async (status) => {
  await expect(readSalonRegistrationResult(response(status, { error: '入力を確認してください' }))).resolves.toEqual({ kind: 'rejected', message: '入力を確認してください' });
});

test.each([
  [200, null], [200, 'html'], [200, []], [200, {}],
  [200, { success: false, id }], [200, { success: true }],
  [200, { success: true, id: 123 }], [200, { success: true, id: 'salon-1' }],
  [500, { success: true, id }], [500, { error: 'error' }],
  [413, { error: 'error' }], [415, { error: 'error' }], [422, { error: 'error' }],
  [400, {}], [403, { error: 123 }], [429, { error: '   ' }],
])('status=%s body=%jは結果不明として保全', async (status, body) => {
  await expect(readSalonRegistrationResult(response(status as number, body))).resolves.toEqual({ kind: 'unknown' });
});

test('JSON解析失敗は結果不明', async () => {
  const res = { ok: true, status: 200, json: async () => { throw new Error('fixture invalid JSON'); } } as unknown as Response;
  await expect(readSalonRegistrationResult(res)).resolves.toEqual({ kind: 'unknown' });
});
