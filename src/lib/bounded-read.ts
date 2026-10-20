// Server-rendered pages must not stream a loading fallback forever when one
// SELECT stalls: the user sees "読み込み中" with no error and no retry. Bound each
// read, abort the transport, and fail into the route's error boundary instead.
// SELECT only; never wrap a mutation or retry it here.
export const PAGE_READ_TIMEOUT_MS = 8000;

export class PageReadTimeoutError extends Error {
  constructor(readonly label: string) {
    super(`PAGE_READ_TIMEOUT:${label}`);
    this.name = 'PageReadTimeoutError';
  }
}

export async function readWithinDeadline<Q extends PromiseLike<unknown>>(label: string, query: Q): Promise<Awaited<Q>> {
  const abortable = query as Q & { abortSignal?: (signal: AbortSignal) => PromiseLike<Awaited<Q>> };
  const controller = new AbortController();
  const deadline = Date.now() + PAGE_READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = typeof abortable.abortSignal === 'function' ? abortable.abortSignal(controller.signal) : query;
    const result = await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Fixed label only: no identifiers, filters or provider messages.
          console.error('[page-read] timeout', { label, ms: PAGE_READ_TIMEOUT_MS });
          reject(new PageReadTimeoutError(label));
          controller.abort();
        }, PAGE_READ_TIMEOUT_MS);
      }),
    ]);
    // A blocked event loop can let the transport settle before the overdue
    // timer runs. Never present a result observed after the deadline.
    if (Date.now() >= deadline) {
      console.error('[page-read] timeout', { label, ms: PAGE_READ_TIMEOUT_MS });
      controller.abort();
      throw new PageReadTimeoutError(label);
    }
    return result as Awaited<Q>;
  } finally { clearTimeout(timer); }
}
