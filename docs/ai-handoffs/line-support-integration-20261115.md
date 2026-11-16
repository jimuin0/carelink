# CareLink LINE support: implementation and verification

Updated 2026-11-16 JST. This is the current record; older prototype counts are historical.

## Target and ownership

- Repository: `jimuin0/carelink`; isolated worktree `work/line-support-integration`.
- Branch: `codex/line-support-integration`; base HEAD `3f7146e50318e710773575d63e1aebbaadc1f20e`.
- Target is identified by a per-file SHA256 manifest and the final local commit recorded in the delivery receipt. Base HEAD is not the implementation or deployment SHA. No remote publish or production release is claimed.
- The user explicitly asked Codex to implement and test, then continued the task. Codex implemented and self-verified. This is **not independent inspection** of its own implementation.
- No other chat, subagent, ChatGPT schedule, production migration, queue creation, webhook switch, merge, deployment or real message send was performed.

## Decision and comparison

CareLink's existing Cloudflare application, Supabase durable inbox/outbox, a durable queue and the authenticated admin console are selected under current constraints. Public answers reuse deployed CareLink definitions. Other consultations produce operator-only proposals for the verified personal LINE recipient. Manual customer replies remain in LINE Official Account Manager; no approval/customer-send command was added. Friendship is not actual recipient binding.

| Alternative | Assessment |
| --- | --- |
| Keep Render bot and edit its prompt | Duplicates facts and retains reproduced routing/state defects. |
| Old bot fetches CareLink knowledge | Useful bridge, but still needs private state, notification workflow and a second deployment. |
| CareLink/Supabase/Cloudflare queue/admin | Reuses definitions, auth, deployment, provider SDK and interface; selected, subject to release gates below. |
| Separate crawler/vector RAG | Current verified facts are small and structured; extra ingestion, freshness and access machinery has no demonstrated benefit here. |
| LINE native AI/third-party helpdesk | Custom shared-fact and personal-draft workflow still needs integration; no demonstrated operational/cost advantage. |

Actual local deterministic comparison: 8 cases. New policy passes 8; legacy passes 0 of 7 applicable cases, with 1 unavailable legacy draft-management case. Legacy commit `38261cdb15e9d1e67f8626358490f70589873a3a`. Network, database and model are mocked in this comparison. It is not a live model-quality benchmark or a proof of universal optimality.

## Implemented behavior and fixed omissions

1. Separate disabled-by-default webhook validates raw LINE signature, destination, complete batch and time bounds before one transaction. Up to 100 ordered events are persisted; opaque IDs only enter the queue. HTTP success requires durable queue acceptance. Replay/collision and incomplete receipts fail closed.
2. Private conversations only. Text, attachments, location, follow/block and withdrawal are handled. Original inbound content is retained privately; withdrawn content is excluded from model context. Attachments/location metadata are not interpreted or sent to the model.
3. Unknown/private/attachment/follow-up cases enter durable human mode during acceptance. Closed cases reopen as human. Consecutive unresolved public questions preserve contextual review rather than dropping the earlier question. Only an authenticated operator can restore automatic mode.
4. Shared facts derive from industry, standard registration, fee, publication and photo definitions. Fees regenerate from the unchanged Terms source at install/build. No consent edition was changed. Facts carry a hash; malformed/missing deployment provenance disables automatic answers.
5. **Document exceptions:** existing listing-publication acceptance proves per-facility document deferral. Therefore document/requirement questions go to human review. General registration replies explicitly describe the standard flow and ask operations about individual document conditions. This qualification participates in the knowledge hash. The model cannot assert individual obligation/exemption/approval from public facts.
6. Verified public FAQs use the short-lived, single-use Reply API. Before claiming, the sender revalidates the original question under current policy/facts. Expired/failed/uncertain replies never become paid automatic customer pushes. They become operator review; uncertain delivery warns about possible duplicate replies. A reply token is never automatically reused.
7. Only personal draft notifications use Push API. Checklist and clean copyable proposal are separate message objects in one request. Recipient, payload and stable push retry key are persisted before the call. Accepted means API acceptance, not reading/delivery proof. Unknown or started sends are not blindly repeated; proposals remain in the console.
8. Receipt-time observe mode is stored, so even unprocessed observe backlog cannot be flushed after switching live. Rollout/recipient changes supersede pending deliveries. Stale conversation/knowledge/recipient versions cannot send. Unattempted stale knowledge can regenerate a new draft/operation without erasing history.
9. Personal binding requires an authenticated platform-admin-issued one-time code, signed personal inbound candidate and authenticated confirmation. Code expiry/replay, fresh admin authority and recipient version are checked transactionally. Unbinding returns to observe and stops automatic sends.
10. Claude uses the existing Anthropic SDK and an explicitly configured existing model, strict JSON, bounded/minimized context, 10-second timeout and no tools. Model text is always operator-only. Per-conversation allowance is 10 attempts/24h plus the existing global daily allowance. Limiter/provider failure remains pending, not fabricated success.
11. Five RLS tables and thirteen service-only RPCs. Browser roles have no private-table reads/writes or privileged RPC execution. Service direct mutations are revoked; SECURITY DEFINER search paths are fixed. Fresh authority is checked in app and DB; admin mutations use CSRF and rate limits.
12. Real queue producer/consumer, bounded retries and DLQ configuration example. No production queue is provisioned. Recovery finds both expired processing leases and prepared outbox interruptions; at most five selected cases per request, without one failure starving all others.
13. Admin console: original messages, proposals, stale warnings, honest delivery states, exact-case notification links, optimistic revision checks, pairing, mode changes and recovery. Facility-less platform operators have the LINE navigation entry. No dummy facility is required.

## Executed verification

All database writes and browser fixtures below used synthetic data in disposable local databases. No real customer/operator send occurred.

| Check | Current result |
| --- | --- |
| Focused support Jest/coverage | 15 suites, 245 pass; measured branches 322/322, lines 324/324. |
| Full Jest coverage | **908 suites and 18,789 tests pass, zero failures**; branches 15,318/15,318. Includes approved inventory correction, readiness guard and dedicated-key precedence. |
| Real PostgreSQL schema workflow | **122 validation steps pass**, zero fail; includes C-locale replay, JSON roundtrip and existing authorization/concurrency/rollback regressions. Local emulation, not GitHub Actions. |
| Support contention | 4 actual observed blockers: replay, exclusive lease, revoked recipient, stale draft; zero provider calls. |
| Fresh Supabase | All 412 migrations replayed. Official CLI generated 5 tables + 13 RPCs; AST adoption replaced only those 18 new entities. No existing type entity changed. |
| Fingerprint | 3,968 records; 155 additions, all LINE support; zero existing records removed/changed. |
| Local Supabase API contracts | 3 suites, 22 pass, zero skip. PostgREST v14.15 HEAD socket contract also passes on the actual rootless Docker bridge. |
| Cloudflare contracts | 40 pass. Runtime/build helper contracts: 44 pass. Platform layout/navigation: 94 pass. |
| Builds/checks | Next production build and Cloudflare build pass. Full lint, no-emit typecheck and React Compiler debt 0 checked; final lint/type status is retained in task logs. |
| Earlier full HTTPS browser regression | Pre-readiness predecessor snapshot: **538 pass, 6 existing feature-disabled skips, zero failure/flaky/retry**; 544 total; Chrome and Mobile Safari. 6 skips: 2 package, 3 subscription, 1 jobs test, all existing disabled product features. |
| Actual support browser flow | Signed webhook → real queue → Worker → Supabase → authenticated console. Observe preview, missing-token proposal, requirement-question human fence, exact-case link, synthetic pairing and unbinding confirmed. Final qualified proposal screenshot saved. No LINE access/model key existed in the local fixture. |
| Secret scan | Final changed-file snapshot and manifest are recorded separately; no private runtime files are deliverables. |

Node 22.23.3 meets the supported range; GitHub CI uses Node 24. Task-local Lima 2.3.0/Docker 29.9.3/PostgreSQL 17.6 were used; only this worktree was mounted read-only. Runtime wrappers target only the disposable daemon. Earlier incomplete browser attempts (missing browser revision, leftover task listener, stripped HOME) and a unit run overlapping dependency installation are not accepted results. Browser versions were installed without removing existing caches. Final E2E used a fresh Supabase reset and fixed transport; no assertions, thresholds or test scope were relaxed.

Bounded model history is eight entries/1,000 characters each; console lists 50 cases, 30 events, 5 drafts, 10 deliveries. Original records remain private in DB. Operators must check latest official LINE history. A manual Manager reply is not observable by the Bot; human mode therefore stays until explicit reset.

## Actual production reads and release gates

Read-only LINE checks: CareLink `@549rbbyi`; monthly quota limited 200, usage 0 at that check; active webhook `https://carelink-j4cg.onrender.com/webhook`. Free Reply API is used for eligible automatic answers; operator pushes share the account allowance. Push sending fails closed for exhausted/unreadable/unlimited/above-200 ceilings. Other account senders may race for the last slot; no unlimited/free notification claim is made.

CLI OAuth still points to another account, but the browser session successfully opened the correct carelink account and Worker. Its production commit equals base HEAD. LINE credential names exist; Anthropic key, Claude model and support feature settings are absent. Only existing Images/assets bindings are present; no queue consumer. Workers Paid is current; account queue count/usage are zero. Official pricing includes 1,000,000 monthly operations, then $0.40/million; normal delivery generally takes 3 operations/message and retries add operations. No queues were created and no budget approval is assumed. Public health was healthy through the browser, with all five dependency probes OK. Terminal HTTP 403 was an access-path failure, not application unhealthiness.

Unresolved gates:

- **DOC-01 resolved:** Explicit user approval received in this chat. Only the prepared API/env inventory additions were applied to CLAUDE.md. All 12 inventory tests pass; no ownership/safety rules or test assertions changed.
- **DEP-01:** Correct Cloudflare browser access is verified. Claude key/model are absent from the current Worker; queue setup/bindings are absent. Existing paid allowance is verified, but live provisioning/usage authorization and actual credential validity still need resolution. No real model call or live text-quality pass is claimed.
- **LINE-01:** Kanbara's actual personal LINE must complete binding; the synthetic test is not his binding. Actual personal notification acceptance/reading and the live path remain unverified.
- **OPS-01:** Confirm Official Account Manager automatic-response coexistence, operational recovery/DLQ handling, actual deployment health/version and rollback. Existing Render bot stays active until a controlled observe cutover and acceptance. Old/new replies must not overlap.
- **REL-01:** Fixed commit/manifest, required final checks and schema/app release order must be recorded before merge/release. Production backups/schema reconciliation and any required permissions remain release prerequisites. No production operation was attempted.

## Primary references

- https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- https://developers.line.biz/en/docs/messaging-api/sending-messages/
- https://developers.line.biz/en/tips/2026/05/28/how-to-count-messages/
- https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
- https://developers.cloudflare.com/queues/configuration/javascript-apis/
- https://developers.cloudflare.com/queues/configuration/batching-retries/
- https://developers.cloudflare.com/queues/platform/pricing/

## Approved inventory correction and production clarification (2026-11-16)

All previous implementation files matched the saved delivery manifest before this correction. The new operator page `/admin/line-support` is an addition inside the same CareLink application/project, distinct from the existing `/admin/line-richmenu` setup guide and the legacy Render Bot. No new official LINE or Supabase project was created. Production Supabase reports no Edge Functions, no `line_logs`, and no new support tables; the four existing booking/LINE tables remain. The current live Render webhook is unchanged. The browser accessed the correct Cloudflare account without creating credentials or exposing encrypted values. Completed Cloudflare and health tabs were closed; IAB inventory is empty.

## Activation-readiness correction and dedicated credential (2026-11-16)

Confirmed defect ACT-01: with a verified recipient but absent runtime settings, the old admin POST returned 200 and attempted to enable live mode. A regression first reproduced expected 503 / actual 200. Fixed: admin GET returns safe readiness categories; the client disables activation and explains missing setup; the server independently refuses live activation before storage/audit. Observe/off/unbind and pairing remain available. Required categories: explicit feature enablement, LINE credentials/destination, draft credential/model, valid daily quota, internal worker credential plus actual durable queue binding, and deployment provenance. Presence checks do not claim credential validity or successful delivery. DB receipts and API DTOs remain separate, and no schema change was made for this guard.

The readiness helper uses the same Cloudflare adapter alias as the webhook; actual queue-backed verification caught and corrected a relative-import mismatch that Node mocks could not reveal. Exact final runtime test: genuine local GoTrue login, CSRF-protected pairing, signed synthetic personal candidate and verification, configuration receipt identifying only `line`/`drafts` as missing, live POST 503, rollout unchanged observe, and cleanup/unbind. Real provider credentials and real messages: zero.

The user chose a new Anthropic key. The dedicated `CLAUDE_API_KEY` now takes precedence over the common `ANTHROPIC_API_KEY`, so a common key cannot silently be billed for support when both are present. Separate tests cover precedence and unusable dedicated configuration. The model is explicitly selected via `LINE_SUPPORT_CLAUDE_MODEL` (fallback `CLAUDE_MODEL`). The existing application model `claude-haiku-4-5-20251001` is listed Active in the current official lifecycle documentation; actual account access/quality still needs validation. No model was silently upgraded.

Final code results after both corrections: 908 Jest suites and 18,789 tests pass, zero failures; full measured branches 15,318/15,318. Focused support: 15 suites, 245 tests, branches 322/322. Cloudflare contracts: 40 pass. Final Next and Cloudflare builds, lint, no-emit typecheck and compiler debt 0 pass. The earlier schema workflow (122 steps) remains applicable: SQL and schema definitions are unchanged. The earlier complete browser regression (538 pass, 6 pre-existing feature-disabled skips) is a predecessor snapshot; current readiness behavior was verified separately in the real Worker/API and authenticated browser. Re-run mandatory release CI on the final PR head before any merge; no merge/deploy is claimed here.

Credential handoff completed 2026-11-16: the user saved `CLAUDE_API_KEY` as a Cloudflare Secret (deployment `8206d384`, ready/100%). Codex read no key value. Codex matched the existing Render `CLAUDE_MODEL=claude-haiku-4-5` and added nonsecret `LINE_SUPPORT_CLAUDE_MODEL=claude-haiku-4-5` (deployment `8b524b19`, ready/100%). Health remained healthy/version `3f7146e` at 2026-11-16T05:34:56.097Z. Secret presence is verified; validity/model quality is not. All credential/setup tabs were closed. Application, DB, queues and webhook had not been released at this checkpoint.

The local test servers and VM were stopped after verification. No ChatGPT scheduling, production DB writes, queue creation, webhook switch or real send occurred. CLI's cached OAuth session still cannot access the intended account; browser access is correct. Do not read other account data or create broader credentials without appropriate authorization.

Model lifecycle reference: https://platform.claude.com/docs/en/about-claude/model-deprecations


## Production cutover request (2026-11-16)

The user explicitly requested switching the carelink official LINE, operating it, and testing it. Target remains `@549rbbyi`; legacy webhook remains the rollback target until acceptance. Added the reviewed durable queue/DLQ configuration to `wrangler.jsonc` and `CLAUDE_API_KEY` to the deployment secret-name inventory. This does not create a new plan or grant access. Queue setup is on the existing paid account; usage/allowance must be checked before creation. CI was currently available on main, so use real PR checks and the existing deployment pipeline. Do not describe the earlier predecessor E2E as final-head validation. Personal LINE recipient confirmation remains required before live activation.


## RECV-01: post-dispatch recovery acknowledgement (2026-11-16)

P2 review finding at `src/app/api/line/support-work/route.ts`: recovery of a prepared customer reply could acknowledge the queue after failed/unknown dispatch even though SQL reopened the event for operator fallback. Regression reproduced expected HTTP 503 / actual 200 for both outcomes. Fixed by rereading the durable receipt after every recovered dispatch, including accepted, failed and uncertain results; only an empty/terminal receipt can acknowledge completion. Applied the same reconciliation to manual recovery so it does not report reopened fallback work as processed. Tests preserve terminal acceptance and cover pending/processing work plus actual queue-adapter retry rather than ack. No database or provider contract changed. Previous green PR-head checks do not qualify the new commit; all required checks must finish on the updated head before merge.


## MAIL-01: unrelated mailbox hydration regression exposed by final CI

At head `702cb0ee4a5e55b6ff518513a3c667cba4daad0d`, CI run `43817248223` rejected one retry-only Mobile Safari pass in the existing operator-mail test. Snapshot: the Draft button had focus, but Inbox remained selected after reload. Initial SSR toolbar/folder controls were enabled before their React handlers existed. An SSR regression reproduced enabled controls / expected disabled. Reused the existing `useClientReady` guard for the initial New and Folder controls; no transport, permission or email-send logic changed. The existing E2E now deliberately delays JavaScript on reload, asserts disabled controls, then verifies normal draft recovery after hydration. Timeout/retries/assertion thresholds are unchanged. Required final-head CI must run again; the flaky run is not a release pass.
