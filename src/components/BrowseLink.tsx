'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * 一覧・回遊用リンク（既定で先読みしない `next/link`）。
 *
 * why（実測・2026年8月14日）:
 *   Next.js 16 は viewport に入った `<Link>` について【動的ルートのデータまで】先読みする。
 *   15.5 系は同じ画面で先読みを 1 本も出していなかった。同一コード・同一データで Next の
 *   版だけを入れ替えて計測した結果（トップページ `/`・load イベント以降に開始した通信）:
 *
 *     Next 15.5.23 → 0 本
 *     Next 16.3.0  → 85 本（うち RSC ページ先読み 約20本）
 *
 *   CareLink のトップは業種・地方・47都道府県・主要都市・こだわり条件という
 *   「数で広がる」導線を持つため、この既定値だと **表示しただけで** `/search`（ビルド出力 `ƒ`
 *   ＝オンデマンド SSR）の検索レンダリングが十数回走る。実 DB クエリを伴うので、閲覧 1 回あたりの
 *   サーバ負荷と関数実行数が桁で増える。
 *
 * when（この既定値が効かない場合）:
 *   呼び出し側が `prefetch` を明示すればそちらが勝つ（spread が後ろにあるため）。
 *   「次に必ず押される」導線（登録 CTA 等）は先読みしたいので、その場合は `next/link` を直接使うか
 *   `prefetch` を明示すること。
 *
 * 再発検知は `e2e/home-prefetch-fanout.spec.ts`（トップの先読み扇状展開に上限を掛ける）。
 * 個々のリンクを数え上げる方式ではなく「トップ全体で何本出たか」を見るので、
 * 新しい一覧を足して先読みが復活すれば、その時点で赤くなる。
 */
export default function BrowseLink(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
