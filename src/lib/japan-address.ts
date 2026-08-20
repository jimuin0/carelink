/**
 * 住所文字列から都道府県・市区町村を取り出す純粋関数。
 *
 * 🔴 なぜ必要か（2026年8月20日・実データで確定）
 * `facility_profiles.prefecture` は `/search` の地域絞り込み（`facilities.ts` の
 * `.eq('prefecture', …)`）と「近くの施設」「似ている施設」の結合キーだが、
 * セルフサーブ経路では【構造的に必ず null】になっていた：
 *   - `salons` に prefecture / city 列が無い（住所は自由文の 1 列だけ）
 *   - `/api/facility/setup` は body の prefecture / city をそのまま入れるが、
 *     `/admin/onboarding` はそれを送らない
 *   - 公開ゲート（`facility-publish-gate.ts`）は menu / photo / staff しか見ない
 *   - `/admin` のオンボーディング・チェックリストにも基本情報の項目が無い
 * 結果、施設は「公開されているのに、地域で探すと出てこない」状態になり得た。
 *
 * `/register` は郵便番号から zipcloud を引いて address1（都道府県）・address2（市区町村）・
 * address3 を受け取っているのに、連結して 1 本の文字列にした時点で構造を捨てていた。
 * 今後はその構造を保持するが、
 *   - 郵便番号を入れずに住所を直接書いた人
 *   - zipcloud が落ちていたとき
 *   - 既に自由文だけで保存されている行
 * を救うため、自由文からの復元もできるようにする。これがこのモジュール。
 *
 * ⚠️ 市区町村の切り出しは完全ではない（後述）。都道府県の判定は 47 件の完全一致なので確実。
 * 判定できないときは null を返し、呼び出し側が「未設定」として扱えるようにする
 * （誤った値を入れるより、空であることが分かるほうが安全）。
 */
import { prefectures } from './constants';

/** 郡部（例: 「〇〇郡△△町」）を 1 つの市区町村として扱うための接尾辞。 */
const CITY_SUFFIXES = ['市', '区', '町', '村'];

/**
 * 住所の先頭から都道府県名を取り出す。
 *
 * 47 都道府県の完全一致で判定するため、誤検出は起きない。
 * 先頭に空白や全角空白があっても許容する。
 *
 * @returns 都道府県名。見つからなければ null。
 */
export function extractPrefecture(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  // 「東京都」と「京都府」のように一方が他方の部分文字列になる組は存在しないが、
  // 将来の追加で取り違えないよう、長いものから照合する。
  const ordered = [...prefectures].sort((a, b) => b.length - a.length);
  for (const pref of ordered) {
    if (trimmed.startsWith(pref)) return pref;
  }
  return null;
}

/**
 * 住所から市区町村を取り出す。
 *
 * 都道府県名を取り除いた残りの先頭から、市/区/町/村 のいずれかまでを市区町村とみなす。
 * 政令指定都市（例: 「大阪市北区」）は【市までで切る】。`/search` の絞り込みは
 * 都道府県が主で、city は補助的な結合キーとして使われるため、粒度は市で揃える。
 *
 * ⚠️ 限界を明示しておく。この関数は表記ゆれのある自由文を機械的に切るだけで、
 * 住所マスタを引いているわけではない：
 *   - 「郡」を含む住所（例: 「〇〇郡△△町」）は「郡」までを含めて町までで切る
 *   - 「市」を含む地名（例: 「四日市市」）は最後の「市」で切れる想定だが、
 *     最初の一致で切るため誤りうる
 * したがって【自由文しか無いときの復元手段】であり、正の入力経路は
 * zipcloud の address1 / address2 をそのまま保持することである。
 *
 * @returns 市区町村名。判定できなければ null。
 */
export function extractCity(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  const pref = extractPrefecture(trimmed);
  const rest = pref ? trimmed.slice(pref.length) : trimmed;
  if (!rest) return null;

  // 「四日市市」のように地名側に接尾辞が含まれる場合を拾うため、
  // 最も後ろにある接尾辞ではなく「最初に現れた接尾辞のうち最も手前」で切る。
  // ただし政令市の「〇〇市△△区」は市で切りたいので、市を優先的に見る。
  const cityIdx = rest.indexOf('市');
  if (cityIdx >= 0) return rest.slice(0, cityIdx + 1);

  let best = -1;
  for (const suffix of CITY_SUFFIXES) {
    const idx = rest.indexOf(suffix);
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  if (best === -1) return null;
  return rest.slice(0, best + 1);
}
