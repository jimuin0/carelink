# ADR-0002: Upstash 障害時の in-memory rate-limit フォールバック
Date: 2026-05-24
Status: Accepted

## Context
Upstash Redis インスタンス `precious-bluebird-74789.upstash.io` が削除/凍結され DNS NXDOMAIN となった。`src/lib/rate-limit.ts` の `checkRateLimit()` 内で `limiter.limit(ip)` が `fetch failed (ENOTFOUND)` を throw し、各 mutation API（`/api/profile`, `/api/notify`, `/api/contact` 等）が一律 500 を返す状態に陥っていた。

既存コードでは `Ratelimit` インスタンスが存在する限り常に Upstash を呼び、失敗時のフォールバックパスが無かった。

## Decision
`src/lib/rate-limit.ts:54-73` の `checkRateLimit()` を try/catch で包み、Upstash 呼び出しが throw した場合に in-memory フォールバック `inMemoryRateLimit()` に切り替える。

```ts
if (limiter) {
  try {
    const { success } = await limiter.limit(ip);
    return !success;
  } catch (e) {
    console.error('[rate-limit] Upstash failure, falling back to in-memory:', ...);
  }
}
return inMemoryRateLimit(ip, fallbackLimit, fallbackWindowMs, prefix);
```

## Consequences
良い点:
- Upstash 障害で本番 API が一律 500 を返す事象が再発しない
- 既存の Ratelimit インスタンスが null の場合のパスと同じ in-memory 実装に統一されるため挙動が予測可能

悪い点:
- サーバーレス間でレート制限カウンタが共有されない（インスタンス毎に独立カウント）
- Upstash 障害が長期化すると分散環境で有効レート制限値が `instances × limit` に膨らむ
- console.error 経由でしか可視化されない（Slack alert は Phase 2 instrumentation で別途投入）

残る課題:
- Upstash 障害の即時検知は `/api/health` の deps チェック（Phase 1）+ UptimeRobot 連携待ち
- in-memory フォールバック中はその旨を `/api/health` で明示するか検討

## Alternatives
1. **Upstash 多重化** (multi-region replication): 課金 + 設定複雑、CareLink 規模では過剰
2. **Redis 自前運用** (Render/Fly.io 等): 運用負荷高
3. **Sentinel / Cluster**: 規模に対して過剰

## References
- 修正コミット: `5ebfe30`
- 障害検知元コミット: `0645ce0` (診断ログ追加)
- `src/lib/rate-limit.ts:54-73`
- runbook: `docs/runbooks/500-surge.md`, `docs/runbooks/external-dep-down.md`
