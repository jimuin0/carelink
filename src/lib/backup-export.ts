/** Fail rather than label a truncated, capped export as complete. */
export function assertNoRowsBeyondExportLimit(totalRows: number, nextPageRows: number, maxRows: number): void {
  if (totalRows + nextPageRows > maxRows) {
    throw new Error('export row limit exceeded');
  }
}

export type BackupExportRow = Record<string, unknown>;

/** UUID primary keys have a stable, unique ordering, unlike created_at. */
export function assertExportPageCursor(rows: BackupExportRow[], afterId: string): string {
  let cursor = afterId;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id <= cursor) {
      throw new Error('invalid export page cursor');
    }
    cursor = row.id;
  }
  return cursor;
}

/** Pull one page at a time. A short page is not EOF: PostgREST may cap it. */
export function createBackupExportStream(options: {
  firstPage: BackupExportRow[];
  readNext: (afterId: string) => Promise<BackupExportRow[]>;
  encodePage: (rows: BackupExportRow[], first: boolean) => Uint8Array;
  maxRows: number;
  onComplete: (rowCount: number) => void;
  onCancel: () => void;
}): ReadableStream<Uint8Array> {
  let pending: BackupExportRow[] | null = options.firstPage;
  let cursor = '';
  let totalRows = 0;
  let first = true;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const page = pending !== null ? pending : await options.readNext(cursor);
        pending = null;
        if (cancelled) return;
        if (page.length === 0) {
          options.onComplete(totalRows);
          controller.close();
          return;
        }
        assertNoRowsBeyondExportLimit(totalRows, page.length, options.maxRows);
        cursor = assertExportPageCursor(page, cursor);
        const chunk = options.encodePage(page, first);
        first = false;
        totalRows += page.length;
        controller.enqueue(chunk);
      } catch (error) {
        if (!cancelled) {
          controller.error(error instanceof Error ? error : new Error('バックアップの出力に失敗しました'));
        }
      }
    },
    cancel() {
      cancelled = true;
      options.onCancel();
    },
  }, { highWaterMark: 0 });
}
