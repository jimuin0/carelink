# Cloudflare staging status — 2026-10-26

Scope: CareLink staging only. No production promotion, DNS changes, paid plans,
real customer tests or production secrets are authorized. Existing Cloudflare
CLI account/Workers/offline OAuth authorization was explicitly approved.

- Staging: https://carelink-staging.tokuhal-jimuin0.workers.dev
- Deployed source: `92dfc6c6efbf682ba7ace4ccc12cd472c5417894`
- Worker version: `89c2efa2-9b84-442e-a73a-039e87d14944`
- Production remains https://carelink-jp.com on Vercel, health healthy,
  version `61b13bb`; no production changes made.
- Hosted staging is intentionally synthetic/read-only, noindex; health 503
  reflects absent DB/mail/cron. It is not a fully migrated application.

## Verification

[Run 40301882987](https://github.com/jimuin0/carelink/actions/runs/40301882987)
passed at `961e1e142e20e0f81c0d315c86698074324aff1f`: 795 unit suites,
16,805 tests, 13,380/13,380 branches, 19 disposable database contracts, and
497 Workers HTTPS browser cases. Zero failures or flaky cases; six existing
held cases remain skipped and are not counted as verified. The real
after-response audit row was asserted exactly once in the disposable DB.

The subsequent `92dfc6c6` change only aliases Vercel Speed Insights to an empty
component in the Cloudflare build. Its production build passed; generated
public code has no Vercel Speed Insights endpoint reference. Hosted login
hydrated with zero observed error/warning console entries.
[Run 40304566145](https://github.com/jimuin0/carelink/actions/runs/40304566145)
was still running when this record was written: inspect its actual outcome,
never infer success from the preceding run. No production merge was performed.

Local evidence is retained under ignored `work/cloudflare-staging/` and
`/tmp/carelink-cloudflare-*`; raw logs are not published. Initial Free-plan
samples exceeded the nominal 10 ms median CPU allowance, although no resource
errors occurred. Sustained production suitability on Free is not established.
No paid plan was enabled.

## Human database setup

A separate Supabase organization named **CareLink 検証環境**, Free, was created.
The `carelink-staging` project form is prepared for Tokyo; the project itself
has not been created. The existing connector cannot access this new organization,
and no existing CLI authentication was available. Do not use the production
organization or copy production data to bypass this boundary.

The browser's credential policy requires the user to generate/store the new DB
password and submit the project creation themselves. The user asked what that
means; creation is not confirmed. Never request the password in chat, read a
password being entered, or submit the pending form on their behalf. The prepared
Supabase tab is retained as a human handoff. Explain that this is an empty,
free test database for login and reservation tests, separate from production.

After creation, validate that it is the new Free project before adapting the
hosted origin allowlist, test-only secrets, image host and cache prefix. Current
guards intentionally reject hosted databases. Full hosted DB/auth/booking
verification is still required; disposable CI is not equivalent evidence.

The expired OAuth error tab could not be closed because browser URL-safety
policy rejects its data URL. Do not bypass that policy. Completed normal tabs
have been closed; the unfinished Supabase creation form remains open.
