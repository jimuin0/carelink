import { assertNoRowsBeyondExportLimit } from '@/lib/backup-export';

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
});
