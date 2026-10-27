import type { Agent } from 'undici';

function dispatcherReader() {
  let dispatcher: Promise<Agent> | undefined;
  // One bounded pool per process. Load it only when a public REST read occurs;
  // unrelated pages and cookie-based authentication do not pay its startup cost.
  return () => dispatcher ??= import('undici').then(({ Agent }) => new Agent({
    connections: 4,
    pipelining: 1,
    allowH2: false,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 60_000,
  }));
}

// Keep public and trusted-server sockets separate. Neither pool stores headers,
// credentials, responses or client/auth state.
const readPublicDispatcher = dispatcherReader();
const readServiceDispatcher = dispatcherReader();

/** Reuse TLS connections, never responses, credentials or Supabase client state. */
function createReadFetch(supabaseUrl: string, readDispatcher: () => Promise<Agent>): typeof fetch {
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

export function createPublicReadFetch(supabaseUrl: string): typeof fetch {
  return createReadFetch(supabaseUrl, readPublicDispatcher);
}

/** Opt-in transport for a trusted server read; auth and writes still bypass it. */
export function createServiceReadFetch(supabaseUrl: string): typeof fetch {
  return createReadFetch(supabaseUrl, readServiceDispatcher);
}
