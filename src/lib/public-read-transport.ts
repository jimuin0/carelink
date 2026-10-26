import type { Agent } from 'undici';

let dispatcher: Promise<Agent> | undefined;

function readDispatcher(): Promise<Agent> {
  // One bounded pool per process. Load it only when a public REST read occurs;
  // unrelated pages and cookie-based authentication do not pay its startup cost.
  return dispatcher ??= import('undici').then(({ Agent }) => new Agent({
    connections: 4,
    pipelining: 1,
    allowH2: false,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 60_000,
  }));
}

/** Reuse TLS connections, never responses, credentials or Supabase client state. */
export function createPublicReadFetch(supabaseUrl: string): typeof fetch {
  const origin = new URL(supabaseUrl).origin;
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : input.toString());
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/') ||
        (method !== 'GET' && method !== 'HEAD')) {
      return fetch(input, init);
    }
    // Keep Next's fetch instrumentation, signals, headers and cache policy.
    // The pool stores sockets only; TLS verification and server idle hints stay on.
    const options: RequestInit & { dispatcher: Agent } = {
      ...init,
      dispatcher: await readDispatcher(),
    };
    return fetch(input, options);
  };
}
