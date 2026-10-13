/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { assertExportPageCursor, assertNoRowsBeyondExportLimit, createBackupExportStream } from '@/lib/backup-export';

describe('assertNoRowsBeyondExportLimit', () => {
  it('does not flag data below the cap', () => {
    expect(() => assertNoRowsBeyondExportLimit(999, 1, 1000)).not.toThrow();
  });

  it('does not flag exactly the cap when the extra page is empty', () => {
    expect(() => assertNoRowsBeyondExportLimit(1000, 0, 1000)).not.toThrow();
  });

  it('flags a non-empty extra page at the cap', () => {
    expect(() => assertNoRowsBeyondExportLimit(1000, 1, 1000)).toThrow('export row limit exceeded');
  });

  it('flags a non-empty extra page after the cap', () => {
    expect(() => assertNoRowsBeyondExportLimit(1200, 3, 1000)).toThrow('export row limit exceeded');
  });

  it('rejects a page that crosses the cap even before totalRows reaches it', () => {
    expect(() => assertNoRowsBeyondExportLimit(999, 2, 1000)).toThrow('export row limit exceeded');
  });
});

describe('export cursor', () => {
  it('accepts a strictly increasing page or an empty page', () => {
    expect(assertExportPageCursor([{ id: 'b' }, { id: 'c' }], 'a')).toBe('c');
    expect(assertExportPageCursor([], 'a')).toBe('a');
  });
  it.each([null, 1, {}, { id: 1 }, { id: '' }, { id: 'a' }])('rejects malformed or non-advancing row %p', row => {
    expect(() => assertExportPageCursor([row as never], 'a')).toThrow('invalid export page cursor');
  });
  it('rejects duplicate IDs inside a page', () => {
    expect(() => assertExportPageCursor([{ id: 'b' }, { id: 'b' }], 'a')).toThrow();
  });
});

function streamOptions() {
  return {
    firstPage: [{ id: 'a' }],
    readNext: jest.fn(async () => [] as Record<string, unknown>[]),
    encodePage: jest.fn((rows: Record<string, unknown>[], first: boolean) => new TextEncoder().encode((first ? 'header\n' : '') + rows.map(row => row.id).join('\n') + '\n')),
    maxRows: 2,
    onComplete: jest.fn(),
    onCancel: jest.fn(),
  };
}

it('does not prefetch without demand; completion is recorded after an actual empty page', async () => {
  const options = streamOptions();
  const reader = createBackupExportStream(options).getReader();
  await new Promise(resolve => setImmediate(resolve));
  expect(options.encodePage).not.toHaveBeenCalled();
  expect(options.readNext).not.toHaveBeenCalled();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('header\na\n');
  expect(options.readNext).not.toHaveBeenCalled();
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  expect(options.readNext).toHaveBeenCalledWith('a');
  expect(options.onComplete).toHaveBeenCalledWith(1);
});

it('encodes later pages without a repeated header and rejects a crossing cap', async () => {
  const options = streamOptions();
  options.readNext.mockResolvedValueOnce([{ id: 'b' }]).mockResolvedValueOnce([{ id: 'c' }]);
  const reader = createBackupExportStream(options).getReader();
  await reader.read();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('b\n');
  await expect(reader.read()).rejects.toThrow('export row limit exceeded');
  expect(options.onComplete).not.toHaveBeenCalled();
});

it('closes an empty source without encoding data', async () => {
  const options = { ...streamOptions(), firstPage: [] };
  expect(await createBackupExportStream(options).getReader().read()).toEqual({ done: true, value: undefined });
  expect(options.onComplete).toHaveBeenCalledWith(0);
  expect(options.encodePage).not.toHaveBeenCalled();
});

it.each([new Error('failed'), 'failed'])('rejects provider failure %p without completion', async failure => {
  const options = streamOptions();
  options.readNext.mockRejectedValue(failure);
  const reader = createBackupExportStream(options).getReader();
  await reader.read();
  await expect(reader.read()).rejects.toThrow();
  expect(options.onComplete).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'])('ignores a late provider %s after cancellation', async outcome => {
  const options = streamOptions();
  let settle!: () => void;
  const started = new Promise<void>(resolve => {
    options.readNext.mockImplementation(() => new Promise((accept, reject) => {
      settle = () => outcome === 'resolve' ? accept([{ id: 'b' }]) : reject(new Error('aborted'));
      resolve();
    }));
  });
  const reader = createBackupExportStream(options).getReader();
  await reader.read();
  const pending = reader.read();
  await started;
  await reader.cancel();
  settle();
  expect(await pending).toEqual({ done: true, value: undefined });
  await new Promise(resolve => setImmediate(resolve));
  expect(options.onCancel).toHaveBeenCalledTimes(1);
  expect(options.encodePage).toHaveBeenCalledTimes(1);
  expect(options.onComplete).not.toHaveBeenCalled();
});
