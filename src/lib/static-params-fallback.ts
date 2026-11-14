/**
 * generateStaticParams が 0 件のときに、存在しないと分かっている slug を 1 件だけ返す。
 *
 * 事前生成するページが 1 件も無いと、ビルド時の試し描画が 1 度も行われない。ルートレイアウトの
 * headers()（CSP の nonce）による「毎回描画する」への切り替えが検出されないまま静的ルートとして
 * 扱われ、実行時の描画が DYNAMIC_SERVER_USAGE（500）になる。公開施設が 0 件の環境
 * （初期データの架空施設を消した新しい環境・点検 A280）で、施設詳細ページが全部 500 になった。
 * この slug は DB に無いので、試し描画は notFound() になり、ページとしては公開されない。
 */
export const NO_STATIC_PARAM_SLUG = '__no-published-facility__';

export function withStaticParamFallback(params: { slug: string }[]): { slug: string }[] {
  return params.length > 0 ? params : [{ slug: NO_STATIC_PARAM_SLUG }];
}
