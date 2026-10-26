# CareLink Cloudflare staging

This is an isolated migration experiment. The production Vercel project, domain,
root package.json/package-lock.json, database, cron and provider credentials are
unchanged. Do not merge or promote this branch as a production migration.

The application base is the published main commit `2ecc6dc4a5eb247cf7ea2be39e473d86d71cd9ac`.
The canonical schema-fingerprint workflow also runs on this staging branch, so
the period-aware business-hours migration and its real disposable-DB fixtures
are checked alongside the Workers browser suite.

## Reproduce

Run `node scripts/prepare-cloudflare-staging.mjs` from the repository root. It
creates a fresh source-only workspace under ignored `work/cloudflare-staging/`
and records its path in `current.json`. In that workspace run:

```sh
npm ci --ignore-scripts
node scripts/ensure-eslint-plugin-link.mjs
npm audit --audit-level=moderate
npm run build:vinext
npm run start:vinext -- --port 3001
```

Configuration files here are templates copied to that workspace. The separate
lockfile pins the Cloudflare/Vite/React toolchain without changing production's
dependencies. Preparation refuses an application package change until this
toolchain is reviewed and refreshed. No existing workspace or original data is
deleted, and node_modules is not linked from another checkout.

## Isolation

- Hosted staging uses only `https://synthetic.invalid` and synthetic keys. It
  cannot authenticate against or write to the production database.
- POST/PUT/PATCH/DELETE are refused before application code in synthetic mode.
- No production notification, OAuth, payment or cron credentials are copied.
- Responses have X-Robots-Tag, and robots.txt disallows all crawling.
- There are no custom domain routes or scheduled triggers in this config.
- The KV binding is a new CareLink staging namespace. Development and CI use a
  local simulation (`remote: false`), never the hosted cache.
- Real database/auth/booking tests run only against the disposable local
  Supabase stack in GitHub CI. Their result is not hosted staging verification.

The Cloudflare workflow uses the existing migration replay, DB contracts,
synthetic fixtures and HTTPS Playwright tests, with the Workers runtime in place
of Next's Node server. Existing production CI configuration remains unchanged.

## Runtime adaptations

The Cloudflare build replaces Vercel Speed Insights with an empty component:
its Vercel-only collection endpoint is unavailable here. Production's Vercel
component and consent-based application analytics remain unchanged.

`output: standalone` is disabled only for the Workers build. Only the OG
renderer's filesystem import is adapted: its own packaged Japanese font assets
come from ASSETS, and resvg uses a precompiled Wasm module. The SVG/image renderer
and its input escaping/limits remain the application's existing implementation.

The Worker translates next.config.mjs's existing fixed-asset CDN allowlist to
Cloudflare's CDN header while preserving browser revalidation. Cookies, errors,
write responses and unmarked routes cannot acquire that cache policy.

Images use the official Cloudflare Images optimizer binding (offline simulation
in development/CI). The Worker removes AVIF negotiation to retain next.config's
WebP-only policy. Images Free includes 5,000 unique transformations/month and
rejects new transformations after that limit rather than charging overages:
https://developers.cloudflare.com/images/pricing/#images-free. No Images Paid
plan or image storage subscription is enabled.

Menu/coupon saves consume the successful JSON response before clearing input or
navigating, completing the browser's fetch lifecycle. A body-read error after
the success status does not turn an acknowledged commit into a retryable write.
Server responses retain
streaming. The homepage map loads its
SVG code when visible, keeping region links and reserved layout available from
the first response; this retains the existing initial JavaScript size budget.

The legacy-registration browser proof freezes the same real Flight prop on both
Next's tuple queue and vinext's string queue. It still requires exactly one
frozen prop and exercises the actual isolated Storage rejection and recovery.
Local-draft reload tests also wait for the form's existing hydration readiness
gate before toggling its controlled details panel.
Draft controls synchronize their committed callbacks in a layout effect: a
newly enabled button must not consult the preceding disabled permission through
a stale passive-effect ref. The unit regression reproduces the dropped click
before that passive effect runs. The isolated platform-control test also checks
that the real after-response audit row reaches the database exactly once.

The local-draft browser suite completes the first-visit essential-only Cookie
choice before scrolling to draft controls. Native event diagnostics reproduced
the lazy banner appearing between mouse-down on the enabled button and mouse-up
on the banner, with unchanged button geometry; no button click was dispatched.
The persistence assertions and single real click remain mandatory. A separate
Mobile Safari project repeats this case 30 times without retries alongside the
entire original suite; failure diagnostics retain only native event metadata,
never input or photo contents.

The disposable CI runner retains bounded dependency installation retries. After
an Azure Ubuntu mirror timeout, the next attempt selects the same official
Ubuntu archive already configured as the runner's fallback; package signatures
and required browser libraries remain enforced. The production workflow and
the developer's machine are unaffected. Runner mirror configuration source:
https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh.

## Hosted verification boundary

See [STATUS.md](STATUS.md) for the latest deployed commit, exact verification
results and the remaining human database-creation step.

The synthetic Worker is available at
https://carelink-staging.tokuhal-jimuin0.workers.dev. Missing DB/mail/cron
dependencies deliberately produce health 503; this is not full application
health or a reason to connect production credentials. The initial deployed
version is `76f966c1-8ffd-4f32-9f82-2299c9ed9442` (source `c8ef078`).

The account remains Workers Free. Initial mixed-route samples had no exceeded
CPU/memory errors, but active-version median CPU was 32.55 ms, above the nominal
Free allowance of 10 ms. Cloudflare documents occasional over-limit flexibility;
successful smoke requests do not establish sustained Free-plan suitability.
See https://developers.cloudflare.com/workers/platform/limits/#cpu-time.
No paid plan has been enabled.

## Completion requirements

Build success or the static 90% compatibility report is not migration success.
Record hosted deployment identity, browser checks, real isolated DB/auth/booking
results, notification completion behavior, CPU/memory and image behavior before
considering production. A paid plan or production domain switch requires the
user's confirmation. Preserve the current Vercel deployment for rollback.
