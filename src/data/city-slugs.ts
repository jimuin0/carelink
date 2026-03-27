/**
 * 全47都道府県の主要市区町村スラッグマッピング
 * 構造: { [prefectureSlug]: { [citySlug]: 市区町村名 } }
 */
export const citySlugs: Record<string, Record<string, string>> = {
  // ── 北海道 ──
  hokkaido: {
    sapporo: '札幌市', asahikawa: '旭川市', hakodate: '函館市', kushiro: '釧路市',
    obihiro: '帯広市', otaru: '小樽市', kitami: '北見市', tomakomai: '苫小牧市',
    ebetsu: '江別市', chitose: '千歳市',
  },
  // ── 青森県 ──
  aomori: {
    'aomori-city': '青森市', hachinohe: '八戸市', hirosaki: '弘前市', towada: '十和田市',
  },
  // ── 岩手県 ──
  iwate: {
    morioka: '盛岡市', ichinoseki: '一関市', oshu: '奥州市', hanamaki: '花巻市',
  },
  // ── 宮城県 ──
  miyagi: {
    sendai: '仙台市', ishinomaki: '石巻市', osaki: '大崎市', natori: '名取市',
    tagajo: '多賀城市',
  },
  // ── 秋田県 ──
  akita: {
    'akita-city': '秋田市', yokote: '横手市', daisen: '大仙市',
  },
  // ── 山形県 ──
  yamagata: {
    'yamagata-city': '山形市', tsuruoka: '鶴岡市', sakata: '酒田市', tendo: '天童市',
  },
  // ── 福島県 ──
  fukushima: {
    'fukushima-city': '福島市', koriyama: '郡山市', iwaki: 'いわき市', aizuwakamatsu: '会津若松市',
  },
  // ── 茨城県 ──
  ibaraki: {
    mito: '水戸市', tsukuba: 'つくば市', hitachi: '日立市', tsuchiura: '土浦市',
    kashima: '鹿嶋市', toride: '取手市',
  },
  // ── 栃木県 ──
  tochigi: {
    utsunomiya: '宇都宮市', oyama: '小山市', tochigi_city: '栃木市', sano: '佐野市',
  },
  // ── 群馬県 ──
  gunma: {
    maebashi: '前橋市', takasaki: '高崎市', ota: '太田市', isesaki: '伊勢崎市',
    kiryu: '桐生市',
  },
  // ── 埼玉県 ──
  saitama: {
    'saitama-city': 'さいたま市', kawaguchi: '川口市', kawagoe: '川越市', tokorozawa: '所沢市',
    koshigaya: '越谷市', kasukabe: '春日部市', soka: '草加市', ageo: '上尾市',
    kumagaya: '熊谷市', niiza: '新座市', asaka: '朝霞市', toda: '戸田市',
    iruma: '入間市', fujimi: '富士見市',
  },
  // ── 千葉県 ──
  chiba: {
    'chiba-city': '千葉市', funabashi: '船橋市', kashiwa: '柏市', matsudo: '松戸市',
    ichikawa: '市川市', urayasu: '浦安市', nagareyama: '流山市', narashino: '習志野市',
    yachiyo: '八千代市', abiko: '我孫子市', sakura: '佐倉市', noda: '野田市',
  },
  // ── 東京都 ──
  tokyo: {
    // 23区
    chiyoda: '千代田区', chuo: '中央区', minato: '港区', shinjuku: '新宿区',
    bunkyo: '文京区', taito: '台東区', sumida: '墨田区', koto: '江東区',
    shinagawa: '品川区', meguro: '目黒区', ota: '大田区', setagaya: '世田谷区',
    shibuya: '渋谷区', nakano: '中野区', suginami: '杉並区', toshima: '豊島区',
    kita: '北区', arakawa: '荒川区', itabashi: '板橋区', nerima: '練馬区',
    adachi: '足立区', katsushika: '葛飾区', edogawa: '江戸川区',
    // 主要市
    hachioji: '八王子市', tachikawa: '立川市', musashino: '武蔵野市', machida: '町田市',
    fuchu: '府中市', chofu: '調布市', kodaira: '小平市', hino: '日野市',
    tama: '多摩市', kokubunji: '国分寺市',
  },
  // ── 神奈川県 ──
  kanagawa: {
    yokohama: '横浜市', kawasaki: '川崎市', sagamihara: '相模原市', fujisawa: '藤沢市',
    yokosuka: '横須賀市', hiratsuka: '平塚市', kamakura: '鎌倉市', atsugi: '厚木市',
    yamato: '大和市', chigasaki: '茅ヶ崎市', ebina: '海老名市', zama: '座間市',
    hadano: '秦野市', odawara: '小田原市',
  },
  // ── 新潟県 ──
  niigata: {
    'niigata-city': '新潟市', nagaoka: '長岡市', joetsu: '上越市', sanjo: '三条市',
  },
  // ── 富山県 ──
  toyama: {
    'toyama-city': '富山市', takaoka: '高岡市',
  },
  // ── 石川県 ──
  ishikawa: {
    kanazawa: '金沢市', hakusan: '白山市', komatsu: '小松市',
  },
  // ── 福井県 ──
  fukui: {
    'fukui-city': '福井市', sakai: '坂井市',
  },
  // ── 山梨県 ──
  yamanashi: {
    kofu: '甲府市', minami_alps: '南アルプス市',
  },
  // ── 長野県 ──
  nagano: {
    'nagano-city': '長野市', matsumoto: '松本市', ueda: '上田市', iida: '飯田市',
  },
  // ── 岐阜県 ──
  gifu: {
    'gifu-city': '岐阜市', ogaki: '大垣市', kakamigahara: '各務原市', tajimi: '多治見市',
  },
  // ── 静岡県 ──
  shizuoka: {
    'shizuoka-city': '静岡市', hamamatsu: '浜松市', numazu: '沼津市', fuji: '富士市',
    fujinomiya: '富士宮市', mishima: '三島市',
  },
  // ── 愛知県 ──
  aichi: {
    nagoya: '名古屋市', toyohashi: '豊橋市', okazaki: '岡崎市', ichinomiya: '一宮市',
    toyota: '豊田市', anjo: '安城市', kasugai: '春日井市', toyokawa: '豊川市',
    kariya: '刈谷市', komaki: '小牧市', inazawa: '稲沢市', seto: '瀬戸市',
  },
  // ── 三重県 ──
  mie: {
    tsu: '津市', yokkaichi: '四日市市', suzuka: '鈴鹿市', matsusaka: '松阪市',
  },
  // ── 滋賀県 ──
  shiga: {
    otsu: '大津市', kusatsu: '草津市', nagahama: '長浜市', hikone: '彦根市',
  },
  // ── 京都府 ──
  kyoto: {
    'kyoto-city': '京都市', uji: '宇治市', nagaokakyo: '長岡京市', kameoka: '亀岡市',
    joyo: '城陽市', muko: '向日市',
  },
  // ── 大阪府 ──
  osaka: {
    // 主要区
    kita: '北区', chuo: '中央区', naniwa: '浪速区', tennoji: '天王寺区',
    abeno: '阿倍野区', yodogawa: '淀川区', miyakojima: '都島区', fukushima: '福島区',
    nishi: '西区', joto: '城東区', sumiyoshi: '住吉区', higashisumiyoshi: '東住吉区',
    hirano: '平野区', ikuno: '生野区', nishinari: '西成区', asahi: '旭区',
    tsurumi: '鶴見区', konohana: '此花区', minato: '港区', taisho: '大正区',
    nishiyodogawa: '西淀川区', higashinari: '東成区', higashiyodogawa: '東淀川区',
    suminoe: '住之江区',
    // 主要市
    sakai: '堺市', takatsuki: '高槻市', suita: '吹田市', toyonaka: '豊中市',
    hirakata: '枚方市', ibaraki_city: '茨木市', yao: '八尾市', neyagawa: '寝屋川市',
    kishiwada: '岸和田市', moriguchi: '守口市', kadoma: '門真市', minoh: '箕面市',
  },
  // ── 兵庫県 ──
  hyogo: {
    kobe: '神戸市', himeji: '姫路市', nishinomiya: '西宮市', amagasaki: '尼崎市',
    akashi: '明石市', takarazuka: '宝塚市', itami: '伊丹市', kawanishi: '川西市',
    kakogawa: '加古川市', sanda: '三田市',
  },
  // ── 奈良県 ──
  nara: {
    'nara-city': '奈良市', kashihara: '橿原市', ikoma: '生駒市', tenri: '天理市',
  },
  // ── 和歌山県 ──
  wakayama: {
    'wakayama-city': '和歌山市', hashimoto: '橋本市',
  },
  // ── 鳥取県 ──
  tottori: {
    'tottori-city': '鳥取市', yonago: '米子市',
  },
  // ── 島根県 ──
  shimane: {
    matsue: '松江市', izumo: '出雲市',
  },
  // ── 岡山県 ──
  okayama: {
    'okayama-city': '岡山市', kurashiki: '倉敷市', tsuyama: '津山市',
  },
  // ── 広島県 ──
  hiroshima: {
    'hiroshima-city': '広島市', fukuyama: '福山市', kure: '呉市', higashihiroshima: '東広島市',
    onomichi: '尾道市',
  },
  // ── 山口県 ──
  yamaguchi: {
    shimonoseki: '下関市', 'yamaguchi-city': '山口市', ube: '宇部市', iwakuni: '岩国市',
  },
  // ── 徳島県 ──
  tokushima: {
    'tokushima-city': '徳島市',
  },
  // ── 香川県 ──
  kagawa: {
    takamatsu: '高松市', marugame: '丸亀市',
  },
  // ── 愛媛県 ──
  ehime: {
    matsuyama: '松山市', imabari: '今治市', niihama: '新居浜市',
  },
  // ── 高知県 ──
  kochi: {
    'kochi-city': '高知市',
  },
  // ── 福岡県 ──
  fukuoka: {
    'fukuoka-city': '福岡市', kitakyushu: '北九州市', kurume: '久留米市',
    iizuka: '飯塚市', omuta: '大牟田市', kasuga: '春日市', chikushino: '筑紫野市',
    onojo: '大野城市', munakata: '宗像市', dazaifu: '太宰府市',
  },
  // ── 佐賀県 ──
  saga: {
    'saga-city': '佐賀市', karatsu: '唐津市', tosu: '鳥栖市',
  },
  // ── 長崎県 ──
  nagasaki: {
    'nagasaki-city': '長崎市', sasebo: '佐世保市', isahaya: '諫早市',
  },
  // ── 熊本県 ──
  kumamoto: {
    'kumamoto-city': '熊本市', yatsushiro: '八代市',
  },
  // ── 大分県 ──
  oita: {
    'oita-city': '大分市', beppu: '別府市', nakatsu: '中津市',
  },
  // ── 宮崎県 ──
  miyazaki: {
    'miyazaki-city': '宮崎市', miyakonojo: '都城市', nobeoka: '延岡市',
  },
  // ── 鹿児島県 ──
  kagoshima: {
    'kagoshima-city': '鹿児島市', kirishima: '霧島市', kanoya: '鹿屋市',
  },
  // ── 沖縄県 ──
  okinawa: {
    naha: '那覇市', okinawa_city: '沖縄市', urasoe: '浦添市', ginowan: '宜野湾市',
    nago: '名護市', chatan: '北谷町',
  },
};

// ── ヘルパー関数 ──

/** 市区町村名を取得 */
export function getCityName(prefectureSlug: string, citySlug: string): string | undefined {
  return citySlugs[prefectureSlug]?.[citySlug];
}

/** 有効な市区町村スラッグか判定 */
export function isValidCitySlug(prefectureSlug: string, slug: string): boolean {
  return slug in (citySlugs[prefectureSlug] ?? {});
}

/** 都道府県の全市区町村を取得 */
export function getCitiesForPrefecture(prefectureSlug: string): { slug: string; name: string }[] {
  const cities = citySlugs[prefectureSlug];
  if (!cities) return [];
  return Object.entries(cities).map(([slug, name]) => ({ slug, name }));
}

/** 全市区町村スラッグの一覧を取得 */
export function getAllCitySlugs(): { prefectureSlug: string; citySlug: string; cityName: string }[] {
  return Object.entries(citySlugs).flatMap(([ps, cities]) =>
    Object.entries(cities).map(([cs, name]) => ({ prefectureSlug: ps, citySlug: cs, cityName: name }))
  );
}

/** 市区町村名 → スラッグの逆引き */
export function getCitySlug(prefectureSlug: string, cityName: string): string | undefined {
  const cities = citySlugs[prefectureSlug];
  if (!cities) return undefined;
  return Object.entries(cities).find(([, name]) => name === cityName)?.[0];
}
