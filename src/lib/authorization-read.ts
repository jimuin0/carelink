// Authorization lookups must fail closed within a bounded observation window.
// This helper is for SELECT queries only; never wrap a mutation or retry it.
export const AUTHORIZATION_READ_TIMEOUT_MS = 5000;
export class AuthorizationReadTimeoutError extends Error {
  constructor() { super('AUTHORIZATION_READ_TIMEOUT'); this.name = 'AuthorizationReadTimeoutError'; }
}
export async function readAuthorization<Q extends PromiseLike<unknown>>(query: Q): Promise<Awaited<Q>> {
  const abortable = query as Q & { abortSignal?: (signal: AbortSignal) => PromiseLike<Awaited<Q>> };
  const controller = new AbortController();
  const deadline = Date.now() + AUTHORIZATION_READ_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = typeof abortable.abortSignal === 'function' ? abortable.abortSignal(controller.signal) : query;
    const result = await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AuthorizationReadTimeoutError());
          controller.abort();
        }, AUTHORIZATION_READ_TIMEOUT_MS);
      }),
    ]);
    if (Date.now() >= deadline) {
      controller.abort();
      throw new AuthorizationReadTimeoutError();
    }
    return result as Awaited<Q>;
  } finally { clearTimeout(timer); }
}
