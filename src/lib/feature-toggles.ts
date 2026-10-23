/**
 * 公開側の一時的な表示トグル（DB feature_flags とは別・単一定数の可逆スイッチ）。
 * 「後日 true に戻すだけで復活させたい単純な表示ON/OFF」はここに追加する。
 * DB駆動の `feature-flags.ts`（`isFeatureEnabled`）とは用途が異なる＝
 * ロールアウト率・ユーザー別配信が不要な、コードレベルの一時オフのみを扱う。
 *
 * 🔴 どのトグルも【データ・テーブル・API・migration は消さない】。画面の導線と案内だけを止める。
 *   true に戻せば、管理画面のナビ・各画面・マイページの導線がそのまま復活する。
 *   ただし静的ファイル `public/llms.txt` だけはコードで出し分けできないため、
 *   求人を戻すときは同ファイルの案内（求人掲載・求人情報）も手で足し戻すこと。
 *   E2E（e2e/admin-jobs・admin-packages*・admin-subscription*・admin-subscribers）は各トグルが
 *   false の間 skip しているので、true に戻すと自動で再開する。admin-large-list-nav（Next 15.5 の
 *   無音遷移の再発ガード）は skip させないよう、常に表示されるブログ一覧で検証している。
 */

/**
 * 求人（/jobs・/jobs/[id]・/admin/jobs・/admin/jobs/applications）の表示スイッチ。
 *
 * 2026年7月16日 神原さん判断＝「求人機能はローンチでは使わない・公開側の求人導線を
 * 一旦非表示にする（機能自体は温存・後日実装）」。
 * 2026年10月23日 神原さん判断＝求人は「今はなし」。管理画面側も同じスイッチに従属させた
 * （公開側が止まっているのに、管理画面で作った求人は誰にも見られず、応募一覧は
 * 「人材紹介連動 — 採用時に紹介手数料が発生します」と存在しない仕組みを約束していた）。
 *
 * false のとき：
 *   - sitemap.ts から /jobs・/jobs/[id] を除外（検索エンジンへの新規露出を止める）
 *   - /jobs・/jobs/[id] の metadata.robots に noindex,nofollow を付与
 *     （直URLアクセス・ページ自体は温存＝404にはしない）
 *   - 管理画面のナビから「求人」「求人応募」を外し、/admin/jobs 配下へ直接来た場合は
 *     「現在この機能は提供していません」を出す（src/app/admin/jobs/layout.tsx）
 *   - /register の「できること」に求人掲載を出さない
 *
 * true に戻すと上記がすべて即座に元の挙動へ復帰する。
 * job_postings/facility_jobs データ・関連 API はこのフラグと無関係に常時動作する（触れていない）。
 */
export const SHOW_JOBS = false;

/**
 * 回数券（service_packages / user_packages）の表示スイッチ。
 *
 * 2026年10月23日 神原さん判断＝回数券は「今はなし」。
 * 管理画面で回数券を作れても、お客様に販売・消化する手段が無く、マイページは
 * 「施設を探して回数券を購入する」と /search へ誘導していた（どこでも買えない約束）。
 *
 * false のとき：
 *   - 管理画面のナビから「回数券」を外し、/admin/packages へ直接来た場合は
 *     「現在この機能は提供していません」を出す（src/app/admin/packages/layout.tsx）
 *   - マイページのナビから「回数券」を外す（ただし既に回数券を持っている人には出し続ける）
 *   - /mypage/packages は購入の案内を出さない（既存の回数券は閲覧のみで表示する）
 *   - お客様向け・管理画面向けの AI 案内の対応範囲から回数券を外す
 *
 * service_packages/user_packages データ・関連 API はこのフラグと無関係に常時動作する。
 */
export const SHOW_PACKAGES = false;

/**
 * 月額プラン（subscription_plans / user_subscriptions）の表示スイッチ。
 *
 * 2026年10月23日 神原さん判断＝月額プランは「今はなし」。
 * 回数券と同じく、作れても申し込み・課金・消化の手段が無く、マイページは
 * 「施設を探して月額プランに申し込む」と /search へ誘導していた。
 *
 * false のときの挙動は SHOW_PACKAGES と同型（/admin/subscription-plans・/mypage/subscriptions）。
 * subscription_plans/user_subscriptions データ・関連 API はこのフラグと無関係に常時動作する。
 */
export const SHOW_SUBSCRIPTIONS = false;

/** 提供を一時的に止められる機能。 */
export type OfferableFeature = 'jobs' | 'packages' | 'subscriptions';
export type OfferState = Record<OfferableFeature, boolean>;

/** 現在の提供状態（上の 3 定数の束）。関数の既定値に使い、テストでは別の状態を渡す。 */
export const OFFER_STATE: OfferState = {
  jobs: SHOW_JOBS,
  packages: SHOW_PACKAGES,
  subscriptions: SHOW_SUBSCRIPTIONS,
};

/** 機能ごとの管理画面のルート（配下の new / edit / applications も含めて止める）。 */
export const ADMIN_FEATURE_ROUTES: Record<OfferableFeature, string> = {
  jobs: '/admin/jobs',
  packages: '/admin/packages',
  subscriptions: '/admin/subscription-plans',
};

/** マイページに専用ページを持つ機能（求人はマイページに無い）。 */
export type MypageOfferableFeature = Exclude<OfferableFeature, 'jobs'>;

export const MYPAGE_FEATURE_ROUTES: Record<MypageOfferableFeature, string> = {
  packages: '/mypage/packages',
  subscriptions: '/mypage/subscriptions',
};

const ADMIN_FEATURES = Object.keys(ADMIN_FEATURE_ROUTES) as OfferableFeature[];
const MYPAGE_FEATURES = Object.keys(MYPAGE_FEATURE_ROUTES) as MypageOfferableFeature[];

/** href が「今は提供していない機能」の管理画面（またはその配下）なら true。ナビの出し分けに使う。 */
export function isUnofferedAdminHref(href: string, state: OfferState = OFFER_STATE): boolean {
  return ADMIN_FEATURES.some((feature) => {
    if (state[feature]) return false;
    const root = ADMIN_FEATURE_ROUTES[feature];
    return href === root || href.startsWith(`${root}/`);
  });
}

/**
 * マイページのナビから外す href。
 * 提供していない機能でも、その人が既に回数券・月額プランを持っていれば外さない
 * （提供を止めても、持っているものが見えなくなってはいけない）。
 */
export function hiddenMypageHrefs(
  held: Record<MypageOfferableFeature, boolean>,
  state: OfferState = OFFER_STATE,
): string[] {
  return MYPAGE_FEATURES
    .filter((feature) => !state[feature] && !held[feature])
    .map((feature) => MYPAGE_FEATURE_ROUTES[feature]);
}

/** 提供中のプラン系機能の表示名（AI 案内の対応範囲に使う）。 */
export function offeredPlanLabels(state: OfferState = OFFER_STATE): string[] {
  const labels: string[] = [];
  if (state.packages) labels.push('回数券');
  if (state.subscriptions) labels.push('月額プラン');
  return labels;
}

/**
 * AI 案内に添える「今は提供していない機能」の注意書き。全て提供中なら空文字。
 * 対応範囲から外すだけだと、聞かれたときに一般論で「設定できます」と答えかねないため明示する。
 */
export function unofferedFeatureNotice(state: OfferState = OFFER_STATE): string {
  const labels: string[] = [];
  if (!state.packages) labels.push('回数券');
  if (!state.subscriptions) labels.push('月額プラン');
  if (!state.jobs) labels.push('求人掲載');
  if (labels.length === 0) return '';
  return `${labels.join('・')}は現在提供していません。これらについて聞かれたら、現在は提供していない機能であることを伝え、購入・申し込み・設定の方法を案内しないこと。`;
}
