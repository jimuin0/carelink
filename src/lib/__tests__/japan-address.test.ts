/**
 * japan-address の検査。
 *
 * この2関数は「自由文しか無いときの復元手段」であって、正の入力経路ではない
 * （正は zipcloud の address1 / address2 をそのまま保持すること）。
 * したがって検査の主眼は次の2つ。
 *   1. 都道府県は 47 件すべてで確実に取れること（`/search` の結合キーなので誤りが致命的）
 *   2. 取れないときに【推測で埋めない】こと。誤った値を入れるより null のほうが安全
 */
import { extractPrefecture, extractCity } from '../japan-address';
import { prefectures } from '../constants';

describe('extractPrefecture', () => {
  it('47 都道府県すべてを先頭一致で取り出せる', () => {
    for (const pref of prefectures) {
      expect(extractPrefecture(`${pref}どこかの市1-2-3`)).toBe(pref);
    }
    // 空振り防止 — 47 件を本当に回したか
    expect(prefectures).toHaveLength(47);
  });

  it('前後の空白があっても取れる', () => {
    expect(extractPrefecture('  大阪府堺市堺区1-2-3')).toBe('大阪府');
    expect(extractPrefecture('　東京都渋谷区1-2-3')).toBe('東京都');
  });

  it('都道府県から始まらない住所は null（推測で埋めない）', () => {
    expect(extractPrefecture('堺市堺区1-2-3')).toBeNull();
    expect(extractPrefecture('渋谷区1-2-3')).toBeNull();
  });

  it('空・null・undefined は null', () => {
    expect(extractPrefecture('')).toBeNull();
    expect(extractPrefecture(null)).toBeNull();
    expect(extractPrefecture(undefined)).toBeNull();
  });

  it('「東京都」と「京都府」を取り違えない', () => {
    expect(extractPrefecture('東京都新宿区1-2-3')).toBe('東京都');
    expect(extractPrefecture('京都府京都市中京区1-2-3')).toBe('京都府');
  });
});

describe('extractCity', () => {
  it.each([
    ['大阪府堺市堺区1-2-3', '堺市'],
    ['東京都渋谷区道玄坂1-2-3', '渋谷区'],
    ['京都府京都市中京区1-2-3', '京都市'],
    ['北海道札幌市中央区1-2-3', '札幌市'],
    ['神奈川県横浜市西区1-2-3', '横浜市'],
  ])('%s → %s', (address, expected) => {
    expect(extractCity(address)).toBe(expected);
  });

  it('政令指定都市は市までで切る（区までは含めない）', () => {
    expect(extractCity('大阪府大阪市北区梅田1-1-1')).toBe('大阪市');
  });

  it('町・村も取れる', () => {
    expect(extractCity('沖縄県国頭郡恩納村1-2-3')).toBe('国頭郡恩納村');
    expect(extractCity('長野県北安曇郡白馬村1-2-3')).toBe('北安曇郡白馬村');
  });

  it('都道府県が付いていなくても市区町村だけは取れる', () => {
    expect(extractCity('堺市堺区1-2-3')).toBe('堺市');
  });

  it('複数の接尾辞があれば最も手前で切る（「区」の後ろの「町」に引きずられない）', () => {
    // 「市」を含まないので接尾辞ループを通る。区が先・町が後ろに現れるため、
    // 後から見た町の位置で上書きしないことを固定する。
    expect(extractCity('東京都渋谷区神宮前町1-2-3')).toBe('渋谷区');
  });

  it('接尾辞が1つも無ければ null（推測で埋めない）', () => {
    expect(extractCity('大阪府')).toBeNull();
    expect(extractCity('どこでもない住所')).toBeNull();
  });

  it('空・null・undefined は null', () => {
    expect(extractCity('')).toBeNull();
    expect(extractCity(null)).toBeNull();
    expect(extractCity(undefined)).toBeNull();
  });

  describe('既知の限界（誤りうることを明示的に固定する）', () => {
    // 住所マスタを引いていない以上ここは正しく切れない。
    // 「直っていない」ことを検査で可視化しておき、将来 zipcloud 由来の値が
    // 常に入るようになったらこの限界が実運用に影響しないことを示す。
    it('「四日市市」は最初の「市」で切れてしまう', () => {
      expect(extractCity('三重県四日市市安島1-2-3')).toBe('四日市');
    });
  });
});
