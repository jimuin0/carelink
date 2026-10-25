# Runtime CPU investigation — 2026-10-25

## Production state and scope

CareLink exceeded Vercel Hobby's normal four-hour Active CPU allowance. The
project's rolling usage display showed 11h33m. On October 25 the dashboard showed
Hobby with a temporary 3× limit increase until November 24, and production health
was healthy on `cbb2281`. This task did not purchase a plan, change limits, or
request that increase. Production had already resumed when checked at 09:41 JST;
that is an observation time, not the time Vercel resumed it.

The normal allowance is shared by the team, not reserved for CareLink. A
temporary increase is not evidence that ordinary free-tier usage is sustainable.

## Evidence and limits of attribution

- CareLink's visible daily chart showed function CPU of approximately 1h27m on
  October 22, 1h38m on October 23, and 2h21m on October 24. The previous ordinary
  days, October 12–20, averaged about seven minutes/day including middleware.
- Runtime breakdown showed container 5h28m, Node.js 24 4h42m, and edge 1h22m in
  the displayed period. The increase coincides with the container rollout.
  This correlation does not allocate every CPU second to an application route.
- Recent request records show static assets as well as pages going through
  `/container`. Repeated requests for one immutable font changed from CDN MISS
  to HIT: the CDN is working; it must not be described as entirely disabled.
- Container stdout is broadcast to concurrent requests. Counts of
  `[runtime-security]` log records are not counts of distinct process starts.
- Custom metric queries require Observability Plus. No paid query access was
  enabled. Basic dashboard data, recent logs, and isolated local measurements
  were used instead; historical per-path CPU attribution remains unavailable.

## Confirmed avoidable work and corrections

The shared footer renders 39 business types × 47 prefectures (1,833 cross-links),
in addition to prefecture and utility links. It and the header used the default
Next.js Link speculation, unlike the existing BrowseLink used elsewhere.

A local production-build browser test reproduced 18 unrequested page-prefetch
requests while opening and scanning the footer, without clicking a destination.
The shared header, footer, and account navigation now use BrowseLink, which
disables speculation while preserving normal click navigation. The browser
regression checks the expanded footer, including links entering the viewport
after expansion, and verifies that an intentional contact-page navigation works.
It runs in the existing desktop Chromium and mobile Safari projects. The existing
home prefetch budget remains unchanged.

Next.js image optimization in the container previously preferred AVIF. A local
measurement using the installed Next.js optimizer on three existing public
images at width 640 and quality 75 used 298ms CPU for AVIF versus 62ms for WebP
combined (approximately 79% less for those encodes). The resulting WebP files
were 11–29KB and larger than the AVIF versions. This is a local encoding
measurement, not a claim of 79% lower total production CPU.

Image negotiation now uses Next.js's default WebP format. An HTTP regression
sends an AVIF-preferred Accept header and validates a real WebP response. Remote
host restrictions, image dimension handling, authentication, CSP nonces, private
response caching, and the patched container Node.js runtime are unchanged.

## Release and recurrence checks

Before merge, run the repository's exact-head lint/type, full unit coverage
(100% branches), dependency/security checks, production build, and the affected
browser scenarios. Keep CI results distinct from local results. After deployment,
verify the actual production commit and health, image content negotiation, and
visible navigation. Save private runtime evidence separately from this document.

Review actual usage after release; local reductions cannot guarantee a monthly
quota under arbitrary traffic. Normal four-hour team usage corresponds to eight
CPU minutes/day averaged over 30 days. Do not rely on the temporary 3× increase
after November 24. The native-runtime migration in draft PR #804 has separate
security/validation prerequisites and is not merged by this mitigation.

References: [container runtime/log broadcast](https://vercel.com/docs/functions/runtimes/container),
[CDN caching](https://vercel.com/docs/caching/cdn-cache),
[Next.js image formats](https://nextjs.org/docs/app/api-reference/components/image#formats).
