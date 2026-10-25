# Container startup and public Preview capabilities

The pinned Next.js runtime preloads every page and API module at startup by
default. CareLink's scale-to-zero container now uses
`experimental.preloadEntriesOnStart: false`, as documented in
[Next.js memory guidance](https://nextjs.org/docs/app/guides/memory-usage).
Requested routes still load normally. The image-build compile-cache warmup uses
a temporary eager launcher, removes it on exit, and leaves the deployed lazy
launcher unchanged. Node remains pinned to 24.22.1; auth, per-request CSP nonces
and private/no-store page responses are unchanged.

A controlled local comparison on Node 24.22.1 (six alternating samples per
mode, same standalone build and bytecode cache, startup + first `/privacy`
request + shutdown) measured CPU medians of 469.361 ms eager and 310.292 ms lazy.
This is a local startup comparison, not a prediction of monthly Vercel CPU use.
Judge the normal Hobby allowance using production observations after release.

Preview receives only the existing public Supabase URL and anon configuration.
No production service-role or notification credential is copied. When
`VERCEL_ENV=preview` and the service-role key is absent:

- Public searches keep their existing anon/RLS reads. The optional private
  monthly-booking-count badge is omitted. Availability is unknown (`null`),
  never invented as available or full, and no anonymous booking read is used.
- `/api/health` checks the public database, enforces an in-memory IP rate limit,
  and reports `scope: public-preview`. Successful public DB access returns
  **degraded**, with private capabilities explicitly skipped, rather than
  claiming full health. DB failure remains HTTP 503/unhealthy.
- This does not provision a complete test backend or certify writes, auth or
  notifications against production. Such flows remain tested using isolated
  local Supabase and synthetic fixtures. An existing dedicated Preview backend
  can supply its own isolated server credentials when authorized.

Production and configured isolated Preview environments retain the full
existing DB/RPC/provider/cron health checks. Missing production private
credentials remain failures. Keep the distinction between public Preview
readiness, full health and actual production deployment verification.
