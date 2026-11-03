> This isolated checkout is based on main 4dabe5bf and uses the approved operator-review publication flow. References below to instant listing and cron fixtures describe prior experiments, not enabled features or verified tests in this checkout.

# Cloudflare Workers local migration experiment

This is a local, synthetic-data experiment, not a production deployment configuration.
Do not deploy it or attach it to a public route. Production stays on the existing
platform. No credentials, real stores, real users, or real notifications belong in
this experiment.

`npm run build:vinext` generates the font files under `public/__carelink_og` and
builds a Worker. It never overwrites a differing file in that generated directory
and rejects symlinked output directories or existing asset files.
After the Worker build it runs `next typegen --webpack` to restore Next.js route
types that vinext otherwise replaces; a failed build still attempts restoration.
The Worker build aliases the OG asset loader, response-after handler, and Vercel-only speed
insight component; the normal Next build keeps its original server-side behavior. The
configuration uses the Cloudflare Images binding for local-asset transformations and does not configure shared ISR/data cache.
Vinext may still use its default per-instance in-memory cache; this is not a shared or
durable cache and its behavior is not evidence of production-wide consistency.
The associated performance, security, and operational implications are not yet
verified; a replacement for Vercel speed monitoring must be selected separately.

For synthetic booking tests only, build with `CARELINK_LOCAL_NO_NOTIFICATIONS=1`.
That substitutes a no-delivery fixture and must never be used in a deployed build.
The scripts in `fixtures/` require a running native Supabase stack rooted at
`/private/tmp/carelink-cf-20261029-db`; they re-read its status and check its identity
before writes. They refuse other stacks. `CARELINK_LOCAL_STACK_STATUS` names the
private status JSON, and the application must listen on `127.0.0.1:18744`.
The destructive-by-design synthetic cron fixtures instead require the dedicated
`/private/tmp/carelink-cf-cron-check-20261029` stack and
`CARELINK_LOCAL_CRON_STACK_STATUS`; they refuse other roots and verify test tables
are empty before writing.
Browser fixtures allow only the loopback application and that local Supabase origin.
The login fixture supports `CARELINK_LOCAL_BROWSER=chromium` (default) or `webkit`;
`cf-local-csp-cache.mjs` checks fresh per-response nonces and no-store headers.
For browser booking over local HTTPS, start `fixtures/local-https-proxy.mjs` with
the same stack status, then run the booking fixture with `CARELINK_LOCAL_HTTPS=1`.
This uses a temporary self-signed certificate and Playwright skips certificate validation
for that loopback-only test, as the CI browser does for its local certificate. It does not
verify deployed TLS. WebKit rejects Secure cookies on loopback HTTP, so that mode cannot
validate the real booking handshake.
The stack used for this investigation differs from the repository's CI-pinned CLI,
so these tests do not replace the CI lifecycle or its security gates.

The Threads backfill integration fixture is separate from the regular unit suite:
`CARELINK_LOCAL_CRON_STACK_STATUS=/path/to/dedicated-status.json npx jest --runInBand --testMatch='**/tools/cloudflare/fixtures/threads-backfill-local.test.ts' --runTestsByPath tools/cloudflare/fixtures/threads-backfill-local.test.ts`.
It verifies the dedicated stack identity before writing synthetic articles, scopes
the cron's article reads to those articles, and intercepts provider requests with
synthetic responses; all other external network requests are rejected. It retains
the synthetic articles and cron logs, and does not prove actual Threads delivery.
The registration follow-up fixture uses the same dedicated status file:
`CARELINK_LOCAL_CRON_STACK_STATUS=/path/to/dedicated-status.json npx jest --runInBand --testMatch='**/tools/cloudflare/fixtures/onboarding-followup-local.test.ts' --runTestsByPath tools/cloudflare/fixtures/onboarding-followup-local.test.ts`.
It creates synthetic applications through the existing consent protocol, adjusts
only those synthetic rows to the follow-up age, and mocks all email delivery.
The review-request fixture uses the same status and can be run with
`CARELINK_LOCAL_CRON_STACK_STATUS=/path/to/dedicated-status.json npx jest --runInBand --testMatch='**/tools/cloudflare/fixtures/review-request-local.test.ts' --runTestsByPath tools/cloudflare/fixtures/review-request-local.test.ts`.
It creates synthetic completed bookings, limits the real candidate results to the
fixture booking, and leaves the resulting synthetic email queue entries pending.
It does not run the delivery worker or contact an email provider.
`favorites-digest-local.test.ts` uses the same invocation pattern and tests the
first-week cutover hold. It requires the dedicated database to have been
initialized during the current Tokyo ISO week; outside that window it fails
rather than pretending the hold was exercised. It creates a confirmed synthetic
account, favorite, and coupon, but never invokes a delivery provider.
`booking-reminder-local.test.ts` uses the same status and invocation pattern. It
simulates the JST 09:00 scheduling decision, mocks email and LINE delivery, scopes
the reminder queries and claim deletion to its own synthetic booking, and leaves
the original local records alone. It does not verify a real timed run or delivery.
The synthetic uncertain reminder is intentionally retained. Empty-stack cron
fixtures must use a newly created dedicated stack, not assume this one is empty.
`birthday-coupon-local.test.ts` uses the same status and invocation pattern. It
creates synthetic confirmed accounts, awards only synthetic points, and replaces
the email provider with a mock. It exercises successful, rejected, and uncertain
responses without external delivery.
`report-delivery-local.test.ts` creates synthetic owners and report rows, scopes
reads to its synthetic facility, and mocks aggregation and email delivery. It
tests report-claim behavior, not the aggregate RPC or real report delivery.
These notification fixtures limit pending-claim monitoring to their own synthetic
records. They simulate provider acknowledgement and reconciliation; they do not
verify external delivery or resolve historical legacy claims.

Secrets are local-only `.dev.vars` values and must never be committed. The local
Worker config declares `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `ADMIN_COOKIE_SECRET` as
required secret bindings; the cron secret used locally must be synthetic. A real
Cloudflare deployment would require separately reviewed secret bindings, environment
isolation, image quota and hosted optimization behavior, cache behavior, auth callbacks, monitoring, cron
ownership, notification behavior, full regression testing and an approved rollout
and rollback. A Workers build or these fixtures do not establish those properties.

The registration binding defaults to `false` and public URL/key bindings default to empty.
`THREADS_USER_ID` also defaults to empty so backfill cannot initiate publication
without a separately supplied local identity and credential.

`registration-classification-local.test.ts` tests the real classification RPC
with synthetic admin and receipt records on the dedicated local stack. It blocks
external fetches and retains its own synthetic records. `registration-classification-ui.spec.ts`
is a local-only Playwright fixture: copy it into a separate test app's `e2e/`
directory and use its exact guarded stack and loopback app origin. It uses test
credentials in memory and must never be run against a hosted database. It does
not exercise real customer delivery or publication.

The GitHub E2E job also runs the existing guarded Playwright suite against a
disposable local workerd after resetting its isolated local Supabase. It uses a
temporary CA trusted by the local Worker and loopback HTTPS; it does not disable
TLS verification or change the fixtures' GitHub Actions/loopback guards. This is
local runtime coverage and is not hosted Cloudflare or real-provider validation.
