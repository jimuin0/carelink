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
- Acupuncture symptoms/certifications on published facility detail pages use
  their existing public SELECT policies, without a private service-role client.
  The isolated API contracts verify both public projections and the symptom join.
- `/api/health` checks the public database, retains the existing IP rate limiter
  (including its bounded fallback when the private RPC capability is absent),
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

## 2026-10-28: sign-in and writes closed in the public Preview

A read-only check of a live Preview (`scope: public-preview`) showed the login,
signup and Google buttons were fully usable and its CSP `connect-src` pointed at
the production project, so a sign-in there would have acted on real production
accounts.

What keeps the public Preview from writing to production is the combination of:

1. No production session can exist on the Preview origin. Only when
   `VERCEL_ENV=preview` and the service-role key is absent, `middleware`
   refuses `/auth/*`, `/mypage`, `/admin` and `/liff` (fixed notice, 403,
   no-store, noindex, no scripts) before the cookie-auth client is created,
   and expires any `sb-*-auth-token` cookie (chunks and PKCE verifier included)
   on every page response, so a session left from before cannot be reused by
   browser clients.
2. The service-role key is absent.
3. Production grants (read-only check, 2026-10-28): every anon/public write
   policy in `public` and `storage` requires `auth.uid()` or is `false`; the only
   anon-executable SECURITY DEFINER app function is the read-only
   `published_special_hours`; the only RLS-less anon-writable table is
   `spatial_ref_sys` (the PostGIS issue, reachable from anywhere, not
   Preview-specific).

As defense in depth, routes built on `withRoute` also refuse non-GET/HEAD/OPTIONS
requests and `/api/auth/*` up front (JSON 403 `preview_read_only`, no alert).
Routes not built on `withRoute` rely on 1–3 above. Production and a Preview with
its own isolated service credentials are unchanged. Successful hosted sign-in
and writes against an isolated backend are still unmeasured.
