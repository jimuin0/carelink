# CareLink Render Cron consolidation

The canonical 17 business job schedules, endpoints, authentication, request timeout
(300 seconds), HTTP success/failure rules, and existing health scripts are unchanged.
GitHub's existing backup cron workflow is unchanged. The consolidation runs on Render,
not ChatGPT scheduled tasks.

## Five retained services

| Service | Runner ticks (UTC) | Business jobs |
| --- | --- | --- |
| carelink-webhook-retry | */15 * * * * | webhook-retry, flag-reviews, waitlist-notify |
| carelink-booking-reminder | 5,50 * * * * | booking-reminder, threads-backfill |
| carelink-daily-summary | 0,10,20,25,40 * * * * | 11 daily/weekly jobs, filtered by canonical hour and weekday |
| carelink-cron-heartbeat | 7,37 * * * * | unchanged |
| carelink-health-check | */5 * * * * | unchanged |

Runner ticks do not change business schedules. All jobs due at a tick start
concurrently; a failure cannot block another due job, and any failure makes the
Render run fail. There are no new automatic retries. The runner logs job names,
nominal UTC slot and HTTP status, never response bodies or credentials. Individual
API cron logs and monitoring job IDs remain intact. The minimum interval between
active slots within each consolidated group is 15 minutes (calendar: 20 minutes),
longer than the five-minute request timeout. Startup delay up to five minutes is
resolved against the latest runner tick; longer delays fail visibly rather than
executing a different job. As with the previous Render crons, platform scheduling
and container startup can delay wall-clock execution within the nominal minute.

## Coordinated production cutover

1. Deploy this revision while `CARELINK_CRON_DISPATCH_FROM` is absent. The
   dispatcher invokes only its original legacy job on that job's original slot;
   additional runner ticks are no-ops. Legacy single-job services remain active.
2. Confirm Blueprint sync changed the three retained runner commands/schedules,
   preserved both monitors and existing environment-group links, and created no
   new service. Removing definitions does not by itself prove old services stopped.
3. Confirm all 18 services have successfully built the new revision, including
   the 13 removed definitions. Those legacy services must contain the retirement
   guard before activation. Do not activate while any old code remains deployed.
4. Add `CARELINK_CRON_DISPATCH_FROM` to existing `carelink-cron-env` as an explicit
   future UTC minute (`YYYY-MM-DDTHH:mm:00Z`). Choose a minute that is not any old
   or new cron tick, allowing all linked deployments to finish first. Confirm the
   value has propagated to all 18 linked services before this instant. Ownership is based on the nominal scheduled slot on both owners, including
   delayed pre-cutover starts. Slots before the instant belong to legacy; slots
   at or after it belong to the dispatcher. Old single-job scripts skip only
   dispatcher-owned slots.
5. Observe scheduled executions, including a multi-job quarter-hour tick, an
   hourly job, a calendar runner, and both monitors. Do not manually trigger
   production side effects to simulate a future weekly/daily time. Tests cover
   the full week; calendar runs with no due jobs should log `jobs=none` and exit 0.
6. Suspend the 13 retired services, preserving their configuration for rollback.
   Verify 5 active CareLink crons and 13 suspended; disable their auto-deploys if
   necessary to avoid building unused legacy runners. Record revision, cutover,
   service IDs, scheduled log evidence and CI versus local verification separately.

The monthly minimum changes from $18 to $5 (a $13 reduction before any active-time
overage). Actual invoices depend on active runtime and prorating. Keep the five
service build filters to avoid rebuilding runners on unrelated application edits.

## Rollback

Do not simply remove the activation value while retired services are suspended:
that would stop their business jobs. First resume the 13 retired services with
the retirement guard still active, restore their auto-deploy settings if changed,
and verify all 18 use the same activation value. Move the activation value to a
future UTC instant on all services; this restores legacy ownership while it is
in the future. The three expanded runners then run only their original jobs.
Restore the previous Blueprint schedules and start commands once legacy ownership
is verified. Coordinate the change outside due ticks and verify the next slots.

## Validation

- Every minute of eight days, all weekdays, UTC day rollover and leap-day cases.
- Exact coverage of all registry jobs, runner schedules, and unchanged backup cron.
- Real Node executable fixtures intercept every HTTP call (no production secrets).
- Concurrent peer completion on HTTP/network failure; failure exit status and safe logs.
- Preparation mode, activation boundary, retired-service no-op and manual invocation.
- Admin schedule export retains job IDs, business UTC/JST times and runner mappings.
- Current Render Blueprint JSON Schema validation, lint/typecheck and full coverage gate.

## Production cutover record (read-only check, 2026-10-20 JST)

Read from the Render dashboard of workspace `jimuin` by the owner; no setting was changed.

- Active CareLink crons: exactly the five retained services, each with a successful latest run.
- Suspended by owner about one day earlier: exactly the 13 retired services (not deleted, rollback possible).
- `carelink-cron-env` has `CARELINK_CRON_DISPATCH_FROM=2026-10-19T05:57:00Z`.
- `carelink-daily-summary`: Blueprint managed, command `node scripts/cron-dispatch.mjs calendar`,
  schedule `0,10,20,25,40 * * * *`, deployed main `d9e56ce` (after PR734 `c33a53a`).
- Its 2026-10-20T06:00Z run logged `jobs=daily-summary` and `daily-summary 成功: HTTP 200`;
  06:40, 08:20 and 08:25 logged `jobs=none` as expected.

Steps 1-4 and 6 are confirmed. Step 5 is only partly confirmed: no run of a job that moved
from a retired service (for example `waitlist-notify` or `flag-reviews` on
`carelink-webhook-retry`) has been read yet. The agent's in-app browser blocks every
dashboard.render.com subresource (`ERR_BLOCKED_BY_CLIENT`) and no Render API key or Chrome
extension was available, so this remains unverified rather than assumed.
