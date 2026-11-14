// Worker-only replacement for src/lib/public-read-transport.ts.
// The Node build reuses TLS sockets through an undici Agent passed as fetch's
// `dispatcher`; the Workers runtime has no such option and the hosted runtime
// rejects those reads. Cloudflare pools outbound connections itself, so the
// platform fetch is used unchanged.
export function createPublicReadFetch(_supabaseUrl: string): typeof fetch {
  return (input, init) => fetch(input, init);
}

export function createServiceReadFetch(_supabaseUrl: string): typeof fetch {
  return (input, init) => fetch(input, init);
}
