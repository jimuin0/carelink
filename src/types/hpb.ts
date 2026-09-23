/**
 * HPB(ホットペッパービューティー)メニュー自動取得の型定義。
 *
 * 客が実際に見る HPB 予約ページから「メニュー名・施術時間・価格・内容・客種別」を取得する。
 * soel の scrape_menu_times_hotpepper.py を CareLink(TypeScript・マルチ施設)向けに移植したもの。
 */

/** クーポン由来かメニュー由来か。HPB の一覧には couponId / menuId が混在する。 */
export type HpbMenuKind = 'coupon' | 'menu';

/** 客種別。判定不能は '?'(管理画面で手直し前提)。 */
export type HpbTarget = '新規' | '既存' | '全員' | '?';

/** 予約ページ1枚から抽出した素の値。 */
export interface HpbParsedReserve {
  /** メニュー名。取得できなければ null。 */
  name: string | null;
  /** 客種別。判定不能は '?'。 */
  target: HpbTarget;
  /** 施術時間(分)。取得できなければ 0。 */
  durationMin: number;
  /** 価格(円)。取得できなければ 0。 */
  price: number;
  /** 説明文。取得できなければ null。 */
  description: string | null;
}

/** 一覧ページから集めた ref(couponId/menuId)1件の情報。 */
export interface HpbListingItem {
  /** couponId(CP…) または menuId(MN…)。 */
  refId: string;
  kind: HpbMenuKind;
  /** 予約ページで順に試す add 候補(店舗/メニューで有効値が異なる)。 */
  adds: number[];
  /** 一覧ブロックから推定した客種別。 */
  targetHint: HpbTarget;
  /** 一覧ブロックから推定した説明文。 */
  description: string | null;
}

/** DB(hpb_menu_durations)へ保存する1行。予約ページ + 一覧メタをマージした最終値。 */
export interface HpbMenuRow {
  refId: string;
  kind: HpbMenuKind;
  /** HPB 店舗ID(slnID)。 */
  storeId: string;
  name: string;
  target: HpbTarget;
  durationMin: number;
  price: number;
  description: string | null;
}

/** 外部取得と保存を分けて報告するための、固定された診断理由。 */
export type HpbFetchStopReason =
  | 'normal_end'
  | 'fetch_error'
  | 'invalid_html'
  | 'page_limit'
  | 'time_budget';

/** 取得できた行を失わず、完全性と未取得数を呼出元まで伝える結果。 */
export interface HpbFetchResult {
  rows: HpbMenuRow[];
  complete: boolean;
  stopReason: HpbFetchStopReason;
  discoveredItems: number;
  unresolvedItems: number;
  failedPages: number;
}
