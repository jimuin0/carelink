# Cloudflare staging status — 2026-10-27

CareLink only, in this session. No production promotion, DNS change, paid plan,
real customer tests, other-chat contact, delegation or ChatGPT schedules.
The existing Cloudflare CLI account/Workers/offline OAuth grant is approved;
do not ask for the same grant again.

## Deployment and source

- Staging: https://carelink-staging.tokuhal-jimuin0.workers.dev
- Deployed and verified source: `2f018e5fc01b4892f6931be0eae2014694794d8e`
- Published application base: `2ecc6dc4a5eb247cf7ea2be39e473d86d71cd9ac`
- Active Worker version: `18d05c60-3cb9-407a-9589-1cc945cde02e`, 100% traffic.
- Production remains on Vercel at https://carelink-jp.com. Read-only health at
  2026-10-27 00:29 JST was HTTP 200, healthy, version `2ecc6dc`.
  Production advanced from `61b13bb` through published main updates during this
  work; this session did not deploy production or change its domain/billing.
- Those published business-hours and operator-mail updates were merged into
  this isolated branch so the migration includes the observed release.

Hosted staging deliberately uses `synthetic.invalid` and synthetic credentials.
Write methods are rejected before app code; robots disallows indexing. No
production credentials, notification/OAuth/payment credentials, custom domains
or cron triggers were added. Health 503 is the expected missing DB/mail/cron
state, not full application health. Hosted login/booking is not yet accepted.

## Passed verification at the deployed commit

Later status-only commits reuse these results; they are not a new CI pass.

[Workers CI 40344942579](https://github.com/jimuin0/carelink/actions/runs/40344942579):
798 unit suites, **16,941 tests**, **13,506/13,506 branches (100%)**, 19 real
local Supabase contracts, and **529 native Workers HTTPS browser cases** passed.
Zero failed or flaky cases. Six existing disabled-feature cases remain skipped:
three monthly-plan cases, two package cases and one jobs case. They are not
counted as verified and their flags were not enabled.

[Schema CI 40344942590](https://github.com/jimuin0/carelink/actions/runs/40344942590)
also passed on the same commit. The canonical PG17 migration fingerprint,
business periods/overnight/24-hour slots, RPC parity, real JSON round trips and
the existing disposable-DB safety/concurrency guards ran successfully.

The draft flake was reproduced with native input metadata: mouse-down reached
the enabled button, but 15 ms later mouse-up reached the newly loaded Cookie
banner, with identical button/viewport geometry. The test now completes the
real essential-only Cookie choice before draft operations. Persistence checks
and one real click remain mandatory; there is no force-click or extra retry.
The earlier local fixed regression passed 80 repetitions and all 18 draft cases
across Chromium/Safari. The latest Workers CI additionally repeats the case 30
times with retries disabled. Draft/photo payloads are excluded from diagnostics.

The dependency download stall is separate. The staging CI retains bounded
installation retries and selects the runner's official signed Ubuntu archive
fallback after a failed Azure attempt. Shell syntax and mirror substitution were
checked; the latest successful run installed dependencies on its first attempt,
so it is not evidence that the fallback branch ran in that attempt.

Fresh isolated install/audit: zero vulnerabilities. Production build and final
TypeScript check passed. Full lint: zero errors, two unchanged existing warnings.
Explicit staged secret scans passed before commits (the optional local hook
was unavailable). The generated server-only prerender key was absent from all
530 public asset files; a private server key is not reported as a public leak.

Hosted post-deployment checks passed: login/signup/registration hydrated with
zero observed browser errors/warnings, anonymous admin redirected to login,
private pages retained CSP/no-store/noindex, robots denied crawling, fixed
assets retained revalidation, optimized image bytes were WebP, and Japanese OG
rendered a real 1200×630 PNG. A nonexistent write probe returned the synthetic
read-only rejection. These checks did not submit credentials or reservations.

Evidence is retained in ignored `work/cloudflare-staging/` and
`/tmp/carelink-cloudflare-*`. The latest isolated build workspace is recorded in
`work/cloudflare-staging/current.json`; original workspaces and raw evidence
are retained. No original data was deleted. This session did not merge a PR into main.

Workers Free remains the selected staging plan; no paid plan was enabled.
Initial mixed-route samples had no resource-limit errors, but median CPU was
32.55 ms versus the nominal 10 ms Free allowance. Sustained production Free-plan
suitability is not established. Production cutover and any charge still require
user confirmation.

## Required human step and dependent work

The separate Supabase organization **CareLink 検証環境** is Free. Its Tokyo
`carelink-staging` project creation form is prepared, but project creation has
not been confirmed. The existing connector cannot access the new organization,
and no existing local Supabase CLI authentication was available. Do not use the
production organization or production data instead.

The browser credential policy requires the user to generate/store the new DB
password and submit project creation themselves. The request to let the agent
proceed does not remove that mandatory handoff. Never request the password in
chat, read an in-progress password field, or submit it on the user's behalf.
Keep the unfinished form open; do not reload or discard it.

After the user completes creation, verify the exact new Free project. Adapt
only the staging hosted-origin allowlist, test-only secrets, image host and a
new cache prefix; current guards intentionally reject hosted DB origins.
Do not purge the existing namespace or copy production credentials/data. Then
verify actual hosted DB/auth/booking behavior with synthetic users/data and no
real customer messages. Disposable CI is not equivalent to that hosted proof.

Completed work tabs were closed. The incomplete Supabase form is retained as
a human handoff; the expired OAuth error tab is no longer present. Do not create
a schedule, promise automatic resumption, contact another chat or delegate.
