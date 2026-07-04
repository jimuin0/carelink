/**
 * HPB(ホットペッパービューティー)の客向け予約ページから
 * 「メニュー名・施術時間・価格・内容・客種別」を取得するスクレイパー。
 *
 * soel の scrape_menu_times_hotpepper.py を TypeScript へ忠実移植したもの。
 * 方式: ログイン不要・公開HTML を fetch して正規表現でパース(cookie/Akamai 不要)。
 *
 * 実データで確定した仕様(soel 側 2026-06-19 実証・豊中82件/イマイ38件=100%取得):
 * - 一覧 `/kr/sln{slnID}/coupon/`(2ページ目以降 `coupon/PN{n}.html`)に couponId と menuId が混在。
 *   各 id にリンクの add 値が付く(`/menu/` は 404 なので使わない)。
 * - 予約ページの有効 add は店舗/メニューで異なる(クーポン=0 or 1 / メニュー=5 or 6)
 *   → 一覧で集めた add 候補を順に試し、所要合計が取れた add を採用。
 * - 見出しが2種(`選択済みクーポン・メニュー` / `選択済みメニュー`)・名前が無括弧の場合あり。
 * - 価格は割引前(¥X→¥Y)を避けるため「所要合計」より前の最後の¥(=料金列)を採用。
 * - 価格0 / 時間不明 / 名前無しは呼び出し側でスキップ(取得失敗を実データに上書きしない・保全)。
 *
 * 純粋パース関数(parseReserve / toMinutes / stripHtml / parseListingMeta)は fetch 非依存。
 * ネットワークを使う関数は FetchFn を注入する(テスト容易性 + 実装の単一責務)。
 */
import type {
  HpbListingItem,
  HpbMenuKind,
  HpbMenuRow,
  HpbParsedReserve,
  HpbTarget,
} from '@/types/hpb';
import { errorMessage } from '@/lib/err';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** HPB へ HTTP GET する関数の型(本番は httpFetch・テストは差し替え)。 */
export type FetchFn = (url: string) => Promise<{ status: number; text: string }>;

/**
 * 1 リクエストのタイムアウト(ms)。HPB は通常 1〜2 秒で応答するため十分。
 * これが無いと、1 件でも HPB が無応答だと fetch が無限に待ち、cron(maxDuration 60s)の
 * 施設間 time-budget(施設"間"でしか効かない)を素通りして関数ごと強制終了→ run 全体が
 * 失敗し success ログも残らない、という発症前リスクになる。本タイムアウトで単一ハングを
 * 必ず有限時間で打ち切る(打ち切り時は呼び出し側が break/continue=既存データは非破壊)。
 */
const FETCH_TIMEOUT_MS = 10_000;

/** 本番用の FetchFn。Node 標準 fetch を使い、UA を付ける。タイムアウトで単一ハングを遮断。 */
export const httpFetch: FetchFn = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
};

/** HTML エンティティを最小限デコード(&amp; は二重デコード防止のため最後)。 */
export function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&yen;/g, '¥')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** HTML タグ除去 + エンティティ復元 + 空白圧縮(soel の _text 相当)。 */
export function stripHtml(html: string): string {
  const noTags = (html || '').replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/[ \t\n\r]+/g, ' ');
}

/** '2時間' / '1時間50分' / '120分' → 整数(分)。取れなければ 0。 */
export function toMinutes(s: string): number {
  const str = s || '';
  const h = str.match(/(\d+)時間/);
  const min = str.match(/(\d+)分/);
  return (h ? parseInt(h[1], 10) : 0) * 60 + (min ? parseInt(min[1], 10) : 0);
}

/**
 * 予約ページHTMLから {name, target, durationMin, price, description} を抽出。
 * 所要時間は「所要合計」を正典(行内の値や add-on 10分の誤検知を避ける)。
 * 価格は「所要合計」より前の最後の¥(割引前 ¥X→¥Y を避け料金列を採る)。
 */
export function parseReserve(html: string): HpbParsedReserve {
  const t = stripHtml(html);
  let i = t.indexOf('選択済みクーポン・メニュー');
  if (i < 0) i = t.indexOf('選択済みメニュー');
  if (i < 0) {
    return { name: null, target: '?', durationMin: 0, price: 0, description: null };
  }
  const seg = t.slice(i, i + 1500);
  const cut = seg.indexOf('所要合計');
  const before = cut >= 0 ? seg.slice(0, cut) : seg;

  // 所要合計(正典)。無ければ before 内の最後の「N分」をフォールバック。
  let durationMin = 0;
  const sm = seg.match(/所要合計[^0-9]{0,10}(\d+時間\d*分?|\d+分)/);
  if (sm) durationMin = toMinutes(sm[1]);
  if (durationMin === 0) {
    const dm = before.match(/(\d+時間\d*分?|\d+分)/g);
    if (dm && dm.length > 0) durationMin = toMinutes(dm[dm.length - 1]);
  }

  // 価格: 所要合計より前の最後の¥(料金列。割引前 ¥X→¥Y の X を避ける)。
  const prices = [...before.matchAll(/[¥￥]([\d,]+)/g)].map((m) => m[1]);
  const price =
    prices.length > 0 ? parseInt(prices[prices.length - 1].replace(/,/g, ''), 10) : 0;

  // 名前: 括弧《》【】優先 → 無ければ「所要時間(目安)」直後〜最初の¥(先頭の対象バッジ除去)。
  let name: string | null;
  const nm = before.match(/([《【][^》】]+[》】][^¥￥]{0,45})/);
  if (nm) {
    name = nm[1].trim();
  } else {
    const mm = before.match(/所要時間\(目安\)\s*([\s\S]+?)\s*[¥￥]/);
    name = mm ? mm[1].trim() : null;
    if (name) {
      name = name.replace(/^(新\s*規|再\s*来|全\s*員)\s*/, '').trim() || null;
    }
  }

  // 客種別: 予約ページ冒頭バッジ/名前プレフィックス(新規/再来=既存/全員)。
  const head = before.slice(0, 200).replace(/ /g, '');
  let target: HpbTarget;
  if (head.includes('全員')) target = '全員';
  else if (head.includes('再来')) target = '既存';
  else if (head.includes('新規')) target = '新規';
  else target = '?';

  // 説明文(クーポンページ): 名前¥価格 の後 〜「提示条件」手前。メニューページには無い→null。
  let description: string | null = null;
  const ddm = before.match(/[¥￥][\d,]+\s+(\S[\s\S]+?)(?:提示条件|利用条件|回数：)/);
  if (ddm) {
    let cand = ddm[1].trim();
    if (name && cand.startsWith(name)) cand = cand.slice(name.length).trim();
    cand = cand.replace(/^[¥￥][\d,]+\s*/, '').trim();
    description = cand.slice(0, 300) || null;
  }

  return { name, target, durationMin, price, description };
}

/** 一覧の ref ブロック直前テキストから {targetHint, description} を推定。 */
export function parseListingMeta(blockText: string): {
  targetHint: HpbTarget;
  description: string | null;
} {
  let target: HpbTarget = '?';
  if (blockText.includes('既存')) target = '既存';
  else if (blockText.includes('新規')) target = '新規';
  else if (blockText.includes('全員')) target = '全員';

  // 価格/所要バッジ(［…］)の後ろの文を説明とみなす。前の item のテキストが混じり得るため
  // ref に最も近い(=最後の)一致を採る。
  let desc: string | null = null;
  const dm = [...blockText.matchAll(/(?:］|[¥￥][\d,]+)\s*([^¥￥］]{6,200}?。)/g)].map(
    (m) => m[1],
  );
  // dm の一致は必ず6文字以上+「。」なので trim 後も非空。
  if (dm.length > 0) desc = dm[dm.length - 1].trim();
  return { targetHint: target, description: desc };
}

const LINK_RE = /(coupon|menu)Id=((?:CP|MN)\d+)&(?:amp;)?add=(\d+)/g;

/**
 * 一覧ページ(全ページ)から {refId, kind, adds[], targetHint, description} を順序保持で収集。
 * couponId/menuId が混在。各 id のリンクに付く add 値を候補として全収集(予約ページで順に試す)。
 */
export async function collectListing(
  sln: string,
  fetchFn: FetchFn,
  maxPages = 12,
): Promise<HpbListingItem[]> {
  const base = `https://beauty.hotpepper.jp/kr/sln${sln}/coupon/`;
  const items = new Map<string, HpbListingItem>();
  for (let n = 1; n <= maxPages; n++) {
    const url = n === 1 ? base : `${base}PN${n}.html`;
    let res: { status: number; text: string };
    try {
      res = await fetchFn(url);
    } catch (e) {
      // 監査X6: 従来は無音でループを打ち切っており、全ページ失敗と正常終端が
      // 区別できなかった。原因切り分けのため warn を残す（打ち切り自体は仕様）。
      console.warn('[hpb-scraper] ページ取得失敗・巡回打ち切り', {
        url, err: errorMessage(e),
      });
      break;
    }
    if (res.status !== 200) break;
    let pageNew = 0;
    for (const m of res.text.matchAll(LINK_RE)) {
      const kind: HpbMenuKind = m[1] === 'coupon' ? 'coupon' : 'menu';
      const ref = m[2];
      const add = parseInt(m[3], 10);
      let it = items.get(ref);
      if (!it) {
        const pos = res.text.indexOf(ref);
        const ctx = stripHtml(res.text.slice(Math.max(0, pos - 600), pos));
        const meta = parseListingMeta(ctx);
        it = {
          refId: ref,
          kind,
          adds: [],
          targetHint: meta.targetHint,
          description: meta.description,
        };
        items.set(ref, it);
        pageNew++;
      }
      if (!it.adds.includes(add)) it.adds.push(add);
    }
    if (pageNew === 0 && n > 1) break; // 新規 id 無し = 末尾ページ巡回防止
  }
  return [...items.values()];
}

const RESERVE_URL = (sln: string, kind: HpbMenuKind, ref: string, add: number) =>
  `https://beauty.hotpepper.jp/CSP/kr/reserve/?storeId=${sln}&${kind}Id=${ref}&add=${add}`;

/** 1店舗の全 couponId/menuId について予約ページを取得し、マージ済み行を返す。 */
export async function fetchStoreRows(
  sln: string,
  fetchFn: FetchFn,
  maxPages = 12,
): Promise<HpbMenuRow[]> {
  const rows: HpbMenuRow[] = [];
  const listing = await collectListing(sln, fetchFn, maxPages);
  for (const it of listing) {
    // collectListing は add 付きリンクからのみ収集するため adds は常に1件以上。
    let info: HpbParsedReserve | null = null;
    for (const add of it.adds) {
      let res: { status: number; text: string };
      try {
        res = await fetchFn(RESERVE_URL(sln, it.kind, it.refId, add));
      } catch (e) {
        // 監査X6: 無音 continue を避け、失敗を可視化する（次候補へ進む挙動は仕様）。
        console.warn('[hpb-scraper] 予約ページ取得失敗・次候補へ', {
          refId: it.refId, err: errorMessage(e),
        });
        continue;
      }
      if (res.status !== 200) continue;
      const parsed = parseReserve(res.text);
      if (parsed.name && parsed.durationMin > 0 && parsed.price > 0) {
        info = parsed;
        break;
      }
    }
    if (!info) continue;
    const target = info.target !== '?' ? info.target : it.targetHint;
    const description = info.description ?? it.description;
    rows.push({
      refId: it.refId,
      kind: it.kind,
      storeId: sln,
      name: info.name as string,
      target,
      durationMin: info.durationMin,
      price: info.price,
      description,
    });
  }
  return rows;
}

/**
 * 全対象店舗を巡回して行を集める。store 単位の取得件数も返す。
 * stores は施設の hpb_sln_id 等から呼び出し側が決める(soel の固定 env と異なりマルチ施設)。
 */
export async function fetchMenuRows(
  stores: string[],
  fetchFn: FetchFn,
  maxPages = 12,
): Promise<{ rows: HpbMenuRow[]; perStore: Record<string, number> }> {
  const rows: HpbMenuRow[] = [];
  const perStore: Record<string, number> = {};
  for (const sln of stores) {
    const srows = await fetchStoreRows(sln, fetchFn, maxPages);
    perStore[sln] = srows.length;
    rows.push(...srows);
  }
  return { rows, perStore };
}
