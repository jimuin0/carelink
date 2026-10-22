/**
 * Microsoft Clarity（ヒートマップ・セッション録画）を動かしてよい画面の単一ソース。
 *
 * 🔴 なぜ必要か（2026年10月22日）
 * Cookie バナーの修正で Clarity は初めて実際に録画を送るようになった（スタブ追加と CSP の
 * connect-src への *.clarity.ms 追加）。ところが計測タグ（components/AnalyticsGate.tsx）は
 * root layout にあり、管理画面・マイページ・予約・問診でも動いていた。Clarity の既定の
 * マスク（Balanced）が隠すのは入力欄だけで、表やカードに文字として表示された内容は録画される。
 * 店舗オーナーが自分の端末で「すべて同意」を押して /admin/customers を開くと、同意していない
 * お客様の氏名・電話番号・メールアドレス・予約メモが Microsoft へ送られる状態だった。
 *
 * 規則（許可リスト。載っていない画面は録画しない＝新しい画面は安全側に倒れる）:
 * - 録画してよいのは、来訪者が施設を探して見るための公開ページだけ（SESSION_RECORDING_PUBLIC_ROOTS
 *   と、都道府県スラッグで始まるエリアページ）。
 * - 公開ページの中でも施設の予約画面（/facility/<slug>/booking 以下）は録画しない。
 * - SESSION_RECORDING_PRIVATE_ROOTS は「録画しない」と決めた画面の記録。判定には使わないが、
 *   src/app 直下の画面がどちらかに必ず分類されていることを
 *   src/lib/__tests__/session-recording-scope.test.ts が検査する（分類漏れのまま増やさない）。
 */
import { isValidPrefectureSlug } from '@/lib/seo-constants';

/** 録画してよい公開ページ（パスの先頭セグメント）。トップ（/）とエリアページは別扱い。 */
export const SESSION_RECORDING_PUBLIC_ROOTS: readonly string[] = [
  'blog',
  'compare',
  'facility',
  'feature',
  'jobs',
  'legal',
  'privacy',
  'ranking',
  'salon',
  'search',
  'symptom',
  'symptom-checker',
  'symptoms',
  'terms',
  'type',
];

/**
 * 録画しない画面（パスの先頭セグメント）。お客様・店舗・申込者の情報を表示または入力する画面。
 * - admin: 店舗の管理画面（顧客一覧・予約・カルテメモなど、第三者であるお客様の情報）
 * - mypage / liff: 予約・ポイント・プロフィールなど本人の情報
 * - auth: ログイン・登録（メールアドレス）
 * - intake: 問診（健康に関する情報）
 * - register / recruit / contact: 掲載申込・問い合わせ（氏名・連絡先）
 * - unsubscribe: 配信停止（メールアドレス）
 */
export const SESSION_RECORDING_PRIVATE_ROOTS: readonly string[] = [
  'admin',
  'auth',
  'contact',
  'intake',
  'liff',
  'mypage',
  'recruit',
  'register',
  'unsubscribe',
];

/** 公開ページの中で録画しない部分（/facility/<slug>/<ここ> 以下）。 */
const FACILITY_PRIVATE_CHILDREN: readonly string[] = ['booking'];

/** この画面で Clarity を動かしてよいか。パスが分からないときは録画しない（安全側）。 */
export function isSessionRecordingAllowedPath(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith('/')) return false;
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  const [root, , child] = segments;
  if (root === undefined) return true; // トップ（/）
  if (root === 'facility') return !FACILITY_PRIVATE_CHILDREN.includes(child ?? '');
  return SESSION_RECORDING_PUBLIC_ROOTS.includes(root) || isValidPrefectureSlug(root);
}
