/**
 * 公開側の一時的な表示トグル（DB feature_flags とは別・単一定数の可逆スイッチ）。
 * 「後日 true に戻すだけで復活させたい単純な表示ON/OFF」はここに追加する。
 * DB駆動の `feature-flags.ts`（`isFeatureEnabled`）とは用途が異なる＝
 * ロールアウト率・ユーザー別配信が不要な、コードレベルの一時オフのみを扱う。
 */

/**
 * 求人（/jobs・/jobs/[id]）の公開導線表示スイッチ。
 *
 * 2026年7月16日 神原さん判断＝「求人機能はローンチでは使わない・公開側の求人導線を
 * 一旦非表示にする（機能自体は温存・後日実装）」。
 *
 * false のとき：
 *   - sitemap.ts から /jobs・/jobs/[id] を除外（検索エンジンへの新規露出を止める）
 *   - /jobs・/jobs/[id] の metadata.robots に noindex,nofollow を付与
 *     （直URLアクセス・ページ自体は温存＝404にはしない）
 *
 * true に戻すと上記が両方とも即座に元の挙動へ復帰する。
 * job_postings/facility_jobs データ・/admin/jobs 管理画面・関連 API はこのフラグと無関係に
 * 常時動作する（触れていない）。
 */
export const SHOW_JOBS = false;
