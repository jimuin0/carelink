/** Fail rather than label a truncated, capped export as complete. */
export function assertNoRowsBeyondExportLimit(totalRows: number, nextPageRows: number, maxRows: number): void {
  if (totalRows >= maxRows && nextPageRows > 0) {
    throw new Error('export row limit exceeded');
  }
}
