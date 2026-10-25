# Collection crawler CPU and SEO mutation regression

A bounded 12-hour request-log sample contained 920 `/search` requests: 701 from GoogleOther, 184 from Amazonbot and 12 from Reflectionbot. These counts identify a workload, not the fraction of total CPU attributable to it. The free observability view groups container work under `/container`; detailed CPU aggregates require paid Observability Plus, which was not enabled.

The existing middleware now rejects GET/HEAD collection requests from these exact crawler families before nonce generation, auth, database access and SSR. `robots.txt` advertises the same policy and remains readable. Googlebot, Bingbot, inspection tools, ordinary visitors and write-method security checks keep their existing flow. User-Agent matching is a resource policy, never authentication. This reduces work for matching crawlers; arbitrary traffic or spoofed agents can still consume resources.

Stateless public-data and service-role Supabase clients disable session persistence and automatic token refresh. A real-SDK lifecycle test verifies that 20 clients create no background intervals (the previous defaults created 20). Cookie-based user authentication retains its separate client; clients are not shared across requests.

A controlled local A/B used the same production build settings, local Node and synthetic empty database responses. Mean CPU per GoogleOther `/search` request fell from 19.90ms (rendered search) to 0.95ms (403), about 95%. This is not a cloud measurement or a forecast of total monthly usage. Normal search access and the actual production commit must be checked after release. These changes complement the navigation/image mitigation in `runtime-cpu-reduction-20261025.md`.

The weekly SEO mutation failure was caused by three missing assertions in an import-time medical department context. The regression loads the module inside an isolated test so per-test mutation tracking exercises map construction, and asserts the complete medical context. The mutation configuration, 100% gate and zero-timeout requirement are unchanged. Unit coverage alone is not evidence that mutation testing passed; retain the actual mutation report and exact tested commit separately.

No billing, database/schema, credential, cron ownership or business notification changes are included. The temporary free 3× allowance expires November 24; these mitigations do not establish permanent free-plan eligibility or guarantee against future quota exhaustion.

References: [Google crawler tokens](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers), [Supabase server admin client options](https://supabase.com/docs/reference/javascript/admin-api).
