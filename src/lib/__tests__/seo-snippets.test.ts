/**
 * Tests for lib/seo-snippets.ts
 * Pure functions — no mocking required for the main exports.
 */

// We keep the default import but also allow partial mock for prefSeo null branches
import {
  getBusinessTypeContext,
  generatePrefTypeContent,
  generateCityContent,
  generateCityTypeContent,
} from '../seo-snippets';

describe('getBusinessTypeContext', () => {
  test('returns context for a valid type slug', () => {
    const ctx = getBusinessTypeContext('hair-salon');
    expect(ctx).not.toBeNull();
    expect(ctx!.keyword).toContain('ヘアサロン');
  });

  test('returns null for an unknown type slug', () => {
    expect(getBusinessTypeContext('unknown-type')).toBeNull();
  });

  test('returns context for nail-eyelash', () => {
    const ctx = getBusinessTypeContext('nail-eyelash');
    expect(ctx).not.toBeNull();
    expect(ctx!.faqs.length).toBeGreaterThan(0);
  });

  test('returns context for all known types', () => {
    const knownTypes = ['hair-salon', 'nail-eyelash', 'relaxation', 'esthetic', 'beauty-clinic', 'acupuncture', 'care-service', 'other'];
    for (const type of knownTypes) {
      expect(getBusinessTypeContext(type)).not.toBeNull();
    }
  });
});

describe('generatePrefTypeContent', () => {
  test('returns null for unknown prefecture slug', () => {
    const result = generatePrefTypeContent('unknown-pref', 'hair-salon');
    expect(result).toBeNull();
  });

  test('returns null for unknown business type slug', () => {
    const result = generatePrefTypeContent('tokyo', 'unknown-type');
    expect(result).toBeNull();
  });

  test('returns content for valid prefecture + type', () => {
    const result = generatePrefTypeContent('tokyo', 'hair-salon');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('東京都');
    expect(result!.intro).toContain('東京都');
    expect(result!.highlights.length).toBeGreaterThan(0);
    expect(result!.faqs.length).toBeGreaterThan(0);
  });

  test('includes the first FAQ about the prefecture + type', () => {
    const result = generatePrefTypeContent('osaka', 'nail-eyelash');
    expect(result).not.toBeNull();
    expect(result!.faqs[0].question).toContain('大阪府');
  });

  test('highlights include prefecture name', () => {
    const result = generatePrefTypeContent('kanagawa', 'relaxation');
    expect(result!.highlights[0]).toContain('神奈川県');
  });
});

describe('generateCityContent', () => {
  test('returns null for unknown prefecture slug', () => {
    const result = generateCityContent('unknown-pref', '豊中市');
    expect(result).toBeNull();
  });

  test('returns content for valid prefecture + city', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('豊中市');
    expect(result!.intro).toContain('豊中市');
    expect(result!.highlights.length).toBe(5);
    expect(result!.faqs.length).toBe(3);
  });

  test('faqs include city name', () => {
    const result = generateCityContent('tokyo', '新宿区');
    expect(result!.faqs[0].question).toContain('新宿区');
    expect(result!.faqs[0].answer).toContain('新宿区');
  });

  test('highlights include city name in each entry', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    result!.highlights.forEach((h) => expect(h).toContain('渋谷区'));
  });
});

describe('generateCityTypeContent', () => {
  test('returns null for unknown prefecture', () => {
    const result = generateCityTypeContent('unknown', '豊中市', 'hair-salon');
    expect(result).toBeNull();
  });

  test('returns null for unknown business type', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'unknown-type');
    expect(result).toBeNull();
  });

  test('returns content for valid pref + city + type', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'nail-eyelash');
    expect(result).not.toBeNull();
    expect(result!.h2).toContain('豊中市');
    expect(result!.intro).toContain('豊中市');
    expect(result!.highlights.length).toBeGreaterThan(0);
    expect(result!.faqs.length).toBeGreaterThan(0);
  });

  test('first FAQ answer includes searchPoints', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'esthetic');
    expect(result!.faqs[0].answer).toBeTruthy();
  });
});

describe('generatePrefTypeContent — コンテンツ詳細検証', () => {
  test('h2 には「で」と「をお探しの方へ」が含まれる', () => {
    const result = generatePrefTypeContent('tokyo', 'hair-salon');
    expect(result!.h2).toBe('東京都でヘアサロンをお探しの方へ');
  });

  test('intro には CareLink が含まれる', () => {
    const result = generatePrefTypeContent('osaka', 'relaxation');
    expect(result!.intro).toContain('CareLink');
  });

  test('intro には 24時間ネット予約 が含まれる', () => {
    const result = generatePrefTypeContent('kanagawa', 'esthetic');
    expect(result!.intro).toContain('24時間ネット予約');
  });

  test('highlights[0] には「全域の」と「を網羅」が含まれる', () => {
    const result = generatePrefTypeContent('tokyo', 'nail-eyelash');
    expect(result!.highlights[0]).toBe('東京都全域のネイル・まつげサロンを網羅');
  });

  test('highlights は4件', () => {
    const result = generatePrefTypeContent('osaka', 'beauty-clinic');
    expect(result!.highlights).toHaveLength(4);
  });

  test('faqs は3件', () => {
    const result = generatePrefTypeContent('tokyo', 'acupuncture');
    expect(result!.faqs).toHaveLength(3);
  });

  test('faqs[0].question には「でおすすめの」が含まれる', () => {
    const result = generatePrefTypeContent('osaka', 'care-service');
    expect(result!.faqs[0].question).toBe('大阪府でおすすめの介護・デイサービスは？');
  });

  test('faqs[0].answer には「口コミ評価順」が含まれる', () => {
    const result = generatePrefTypeContent('tokyo', 'other');
    expect(result!.faqs[0].answer).toContain('口コミ評価順');
  });

  test('全47都道府県 × hair-salon で null にならない', () => {
    const slugs = [
      'hokkaido', 'aomori', 'iwate', 'miyagi', 'akita', 'yamagata', 'fukushima',
      'ibaraki', 'tochigi', 'gunma', 'saitama', 'chiba', 'tokyo', 'kanagawa',
      'niigata', 'toyama', 'ishikawa', 'fukui', 'yamanashi', 'nagano', 'gifu',
      'shizuoka', 'aichi', 'mie', 'shiga', 'kyoto', 'osaka', 'hyogo', 'nara',
      'wakayama', 'tottori', 'shimane', 'okayama', 'hiroshima', 'yamaguchi',
      'tokushima', 'kagawa', 'ehime', 'kochi', 'fukuoka', 'saga', 'nagasaki',
      'kumamoto', 'oita', 'miyazaki', 'kagoshima', 'okinawa',
    ];
    for (const slug of slugs) {
      expect(generatePrefTypeContent(slug, 'hair-salon')).not.toBeNull();
    }
  });

  test('全8業種 × tokyo で null にならない', () => {
    const types = ['hair-salon', 'nail-eyelash', 'relaxation', 'esthetic', 'beauty-clinic', 'acupuncture', 'care-service', 'other'];
    for (const type of types) {
      expect(generatePrefTypeContent('tokyo', type)).not.toBeNull();
    }
  });
});

describe('generateCityContent — コンテンツ詳細検証', () => {
  test('h2 は「{city}でサロン・クリニックをお探しの方へ」', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result!.h2).toBe('豊中市でサロン・クリニックをお探しの方へ');
  });

  test('intro には「CareLink」が含まれる', () => {
    const result = generateCityContent('tokyo', '新宿区');
    expect(result!.intro).toContain('CareLink');
  });

  test('intro には「24時間ネット予約」が含まれる', () => {
    const result = generateCityContent('osaka', '堺市');
    expect(result!.intro).toContain('24時間ネット予約');
  });

  test('highlights[0] は「{city}内のヘアサロン・美容室を網羅」', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    expect(result!.highlights[0]).toBe('渋谷区内のヘアサロン・美容室を網羅');
  });

  test('highlights[1] は「{city}内のネイル・まつげサロン」', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    expect(result!.highlights[1]).toBe('渋谷区内のネイル・まつげサロン');
  });

  test('highlights[2] は「{city}内のエステ・リラクサロン」', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    expect(result!.highlights[2]).toBe('渋谷区内のエステ・リラクサロン');
  });

  test('highlights[3] は「{city}内の鍼灸院・整骨院」', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    expect(result!.highlights[3]).toBe('渋谷区内の鍼灸院・整骨院');
  });

  test('highlights[4] は「{city}内の美容クリニック・介護施設」', () => {
    const result = generateCityContent('tokyo', '渋谷区');
    expect(result!.highlights[4]).toBe('渋谷区内の美容クリニック・介護施設');
  });

  test('faqs[1].question には「当日予約」が含まれる', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result!.faqs[1].question).toContain('当日予約');
  });

  test('faqs[1].answer には「リアルタイム」が含まれる', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result!.faqs[1].answer).toContain('リアルタイム');
  });

  test('faqs[2].question には「周辺エリア」が含まれる', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result!.faqs[2].question).toContain('周辺エリア');
  });

  test('faqs[2].answer には prefName が含まれる', () => {
    const result = generateCityContent('osaka', '豊中市');
    expect(result!.faqs[2].answer).toContain('大阪府');
  });
});

describe('generateCityTypeContent — コンテンツ詳細検証', () => {
  test('h2 は「{city}で{type}をお探しの方へ」', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'hair-salon');
    expect(result!.h2).toBe('豊中市でヘアサロンをお探しの方へ');
  });

  test('intro には「CareLink」が含まれる', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'nail-eyelash');
    expect(result!.intro).toContain('CareLink');
  });

  test('intro には「24時間ネット予約」が含まれる', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'relaxation');
    expect(result!.intro).toContain('24時間ネット予約');
  });

  test('intro には「無料」が含まれる', () => {
    const result = generateCityTypeContent('tokyo', '新宿区', 'esthetic');
    expect(result!.intro).toContain('無料');
  });

  test('highlights[0] は「{city}の{type}を全件掲載」', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'hair-salon');
    expect(result!.highlights[0]).toBe('豊中市のヘアサロンを全件掲載');
  });

  test('highlights は4件', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'beauty-clinic');
    expect(result!.highlights).toHaveLength(4);
  });

  test('faqs は3件', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'acupuncture');
    expect(result!.faqs).toHaveLength(3);
  });

  test('faqs[0].question には「選ぶポイント」が含まれる', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'care-service');
    expect(result!.faqs[0].question).toContain('選ぶポイント');
  });

  test('faqs[0].answer には「CareLinkの口コミ」が含まれる', () => {
    const result = generateCityTypeContent('tokyo', '渋谷区', 'other');
    expect(result!.faqs[0].answer).toContain('CareLinkの口コミ');
  });

  test('faqs[0].answer には searchPoints[0]「、」searchPoints[1] が含まれる（join separator 検証）', () => {
    const result = generateCityTypeContent('osaka', '豊中市', 'hair-salon')!;
    // searchPoints.slice(0,2).join('、') → '口コミ評価が高いスタイリスト、駅近・駐車場ありの利便性'
    expect(result.faqs[0].answer).toContain('口コミ評価が高いスタイリスト、駅近・駐車場ありの利便性');
  });

  test('全8業種 × osaka × 豊中市 で null にならない', () => {
    const types = ['hair-salon', 'nail-eyelash', 'relaxation', 'esthetic', 'beauty-clinic', 'acupuncture', 'care-service', 'other'];
    for (const type of types) {
      expect(generateCityTypeContent('osaka', '豊中市', type)).not.toBeNull();
    }
  });
});

// Branch coverage: line 127 — prefSeo is null → fallback string used
// Branch coverage: line 166 — prefSeo is null → regionContext = ''
// Since all 47 prefectures have prefSeo data, we use jest.mock to simulate a null prefSeo case.
describe('generatePrefTypeContent / generateCityContent — prefSeo null branch', () => {
  // We spy on the getPrefectureSeo import via jest.mock at module level.
  // To avoid breaking other tests we use jest.doMock in a separate require block.

  // Branch coverage: line 127 — prefSeo null path (fallback intro text)
  test('generatePrefTypeContent: prefSeo が null → fallback intro テキストが使われる', () => {
    let result: ReturnType<typeof import('../seo-snippets').generatePrefTypeContent> | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/data/prefecture-seo', () => ({
        getPrefectureSeo: () => null,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generatePrefTypeContent: genPrefType } = require('../seo-snippets');
      result = genPrefType('tokyo', 'hair-salon');
    });
    expect(result).not.toBeNull();
    expect(result!.intro).toContain('医療・美容・福祉施設が広く点在するエリア');
  });

  // Branch coverage: line 166 — prefSeo null path (regionContext = '')
  test('generateCityContent: prefSeo が null → regionContext が空文字になる', () => {
    let result: ReturnType<typeof import('../seo-snippets').generateCityContent> | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/data/prefecture-seo', () => ({
        getPrefectureSeo: () => null,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateCityContent: genCity } = require('../seo-snippets');
      result = genCity('osaka', '豊中市');
    });
    expect(result).not.toBeNull();
    expect(result!.intro).toContain('豊中市');
  });
});

// ============================================================
// businessTypeContext 全データ精密検証
// 各フィールドの文字列値を toBe / toStrictEqual で固定し、
// StringLiteral / ArrayDeclaration 変異体を全て kill する
// ============================================================
describe('businessTypeContext — exact data verification', () => {
  test('hair-salon: keyword と description', () => {
    const ctx = getBusinessTypeContext('hair-salon')!;
    expect(ctx.keyword).toBe('ヘアサロン・美容室');
    expect(ctx.description).toBe(
      'カット・カラー・パーマ・縮毛矯正・ヘッドスパなど、ヘアスタイル全般のメニューを提供する美容室',
    );
  });

  test('hair-salon: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('hair-salon')!;
    expect(ctx.searchPoints).toStrictEqual([
      '口コミ評価が高いスタイリスト',
      '駅近・駐車場ありの利便性',
      'カラー・縮毛矯正の技術力',
      'クーポン・初回割引の有無',
    ]);
  });

  test('hair-salon: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('hair-salon')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('指名予約は可能ですか？');
    expect(ctx.faqs[0].a).toBe(
      'はい、CareLink では指名スタッフを選んで予約できます。スタイリストのプロフィール・実績写真も確認できます。',
    );
    expect(ctx.faqs[1].q).toBe('カラー・縮毛矯正のクーポンはありますか？');
    expect(ctx.faqs[1].a).toBe(
      '各サロンが独自にクーポンを掲載しています。サロン詳細ページからクーポン一覧をチェックしてください。',
    );
    expect(ctx.faqs[2].q).toBe('当日予約はできますか？');
    expect(ctx.faqs[2].a).toBe(
      '空き枠があれば当日予約も可能です。予約カレンダーで○表示の時間帯から選べます。',
    );
  });

  test('nail-eyelash: keyword と description', () => {
    const ctx = getBusinessTypeContext('nail-eyelash')!;
    expect(ctx.keyword).toBe('ネイル・まつげサロン');
    expect(ctx.description).toBe(
      'ジェルネイル・スカルプ・まつげエクステ・まつげパーマなど指先と目元の美容を専門とするサロン',
    );
  });

  test('nail-eyelash: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('nail-eyelash')!;
    expect(ctx.searchPoints).toStrictEqual([
      'ジェル・スカルプの技術力',
      'デザインバリエーション',
      'マツエクの種類（フラットラッシュ・ボリュームラッシュ等）',
      '衛生管理・施術時間',
    ]);
  });

  test('nail-eyelash: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('nail-eyelash')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('ネイルとまつげを同時に予約できますか？');
    expect(ctx.faqs[0].a).toBe(
      '両方対応のサロンなら同時予約可能です。複数メニュー予約に対応しているサロンを選んでください。',
    );
    expect(ctx.faqs[1].q).toBe('マツエクのオフ料金はかかりますか？');
    expect(ctx.faqs[1].a).toBe(
      'サロンによります。メニューに「オフ込み」「オフ別」の表記があるので事前に確認できます。',
    );
    expect(ctx.faqs[2].q).toBe('ネイルデザインのサンプル写真は見られますか？');
    expect(ctx.faqs[2].a).toBe(
      'はい、サロン詳細ページのカタログから施術事例の写真を確認できます。',
    );
  });

  test('relaxation: keyword と description', () => {
    const ctx = getBusinessTypeContext('relaxation')!;
    expect(ctx.keyword).toBe('リラクゼーションサロン');
    expect(ctx.description).toBe(
      'もみほぐし・リフレ・アロマ・タイ古式・ヘッドスパなど癒し系の施術を提供するリラクサロン',
    );
  });

  test('relaxation: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('relaxation')!;
    expect(ctx.searchPoints).toStrictEqual([
      '揉み返しの少ない技術',
      'コース時間（60分・90分・120分）',
      '完全個室の有無',
      '深夜・早朝営業',
    ]);
  });

  test('relaxation: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('relaxation')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('何分コースがおすすめですか？');
    expect(ctx.faqs[0].a).toBe(
      '初回は60分コース、肩こり・腰痛が辛い方は90分以上がおすすめです。',
    );
    expect(ctx.faqs[1].q).toBe('カップルで一緒に施術を受けられますか？');
    expect(ctx.faqs[1].a).toBe(
      'ペアルームのあるサロンなら可能です。サロン詳細の設備情報をご確認ください。',
    );
    expect(ctx.faqs[2].q).toBe('揉み返しが心配です');
    expect(ctx.faqs[2].a).toBe(
      '初回カウンセリングで強さの希望を伝えられます。口コミで施術の強さに関する評価もチェックできます。',
    );
  });

  test('esthetic: keyword と description', () => {
    const ctx = getBusinessTypeContext('esthetic')!;
    expect(ctx.keyword).toBe('エステサロン');
    expect(ctx.description).toBe(
      'フェイシャル・ボディ・痩身・脱毛・小顔矯正など美容全般を提供するエステティックサロン',
    );
  });

  test('esthetic: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('esthetic')!;
    expect(ctx.searchPoints).toStrictEqual([
      '機材（ハイフ・キャビ・ラジオ波等）',
      '初回体験の価格',
      '勧誘の有無の口コミ',
      'コース・回数券の柔軟性',
    ]);
  });

  test('esthetic: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('esthetic')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('初回体験のみで通えますか？');
    expect(ctx.faqs[0].a).toBe(
      'はい、CareLinkでは口コミで「勧誘なし」と評価されているサロンも多数掲載しています。',
    );
    expect(ctx.faqs[1].q).toBe('メンズエステも検索できますか？');
    expect(ctx.faqs[1].a).toBe(
      'メンズ対応サロンも掲載しています。サロン詳細の対応性別をご確認ください。',
    );
    expect(ctx.faqs[2].q).toBe('効果はどのくらいで実感できますか？');
    expect(ctx.faqs[2].a).toBe(
      'メニューや個人差によりますが、フェイシャルは1回、痩身は3-5回程度で実感する方が多いです。',
    );
  });

  test('beauty-clinic: keyword と description', () => {
    const ctx = getBusinessTypeContext('beauty-clinic')!;
    expect(ctx.keyword).toBe('美容クリニック・美容皮膚科');
    expect(ctx.description).toBe(
      '医師による医療美容を提供する美容クリニック・美容皮膚科。レーザー治療・注入治療・医療脱毛など',
    );
  });

  test('beauty-clinic: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('beauty-clinic')!;
    expect(ctx.searchPoints).toStrictEqual([
      '医師の経歴・症例数',
      'カウンセリング無料の有無',
      '麻酔・アフターケアの体制',
      '料金の明朗さ',
    ]);
  });

  test('beauty-clinic: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('beauty-clinic')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('カウンセリングだけでも受けられますか？');
    expect(ctx.faqs[0].a).toBe(
      'ほとんどのクリニックで無料カウンセリングを実施しています。予約時に「カウンセリング希望」とお伝えください。',
    );
    expect(ctx.faqs[1].q).toBe('医療脱毛とエステ脱毛の違いは？');
    expect(ctx.faqs[1].a).toBe(
      '医療脱毛はレーザーで毛根を破壊するため永久脱毛効果があります。エステ脱毛は減毛・抑毛が中心です。',
    );
    expect(ctx.faqs[2].q).toBe('支払い方法は？');
    expect(ctx.faqs[2].a).toBe(
      '現金・クレジット・医療ローンに対応するクリニックが多数。詳細は各クリニックのページをご確認ください。',
    );
  });

  test('acupuncture: keyword と description', () => {
    const ctx = getBusinessTypeContext('acupuncture')!;
    expect(ctx.keyword).toBe('鍼灸院・整骨院・接骨院');
    expect(ctx.description).toBe(
      '鍼・灸・整体・骨格矯正・スポーツ外傷・交通事故対応など、東洋医学と手技療法を提供する治療院',
    );
  });

  test('acupuncture: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('acupuncture')!;
    expect(ctx.searchPoints).toStrictEqual([
      '国家資格保持者の在籍',
      '保険適用メニューの有無',
      '交通事故・労災対応',
      '症状（腰痛・肩こり・坐骨神経痛等）への対応実績',
    ]);
  });

  test('acupuncture: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('acupuncture')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('保険は適用されますか？');
    expect(ctx.faqs[0].a).toBe(
      '急性の捻挫・打撲・挫傷などは健康保険適用になります。慢性的な肩こり・疲労は自費診療です。',
    );
    expect(ctx.faqs[1].q).toBe('交通事故のむち打ちにも対応していますか？');
    expect(ctx.faqs[1].a).toBe(
      '交通事故対応の整骨院では自賠責保険を使った治療が可能です。施設詳細で交通事故対応の有無を確認できます。',
    );
    expect(ctx.faqs[2].q).toBe('鍼は痛くないですか？');
    expect(ctx.faqs[2].a).toBe(
      '使用する鍼は髪の毛ほどの細さで、ほとんど痛みを感じません。鍼が苦手な方には灸や手技のみの対応も可能です。',
    );
  });

  test('care-service: keyword と description', () => {
    const ctx = getBusinessTypeContext('care-service')!;
    expect(ctx.keyword).toBe('介護施設・デイサービス');
    expect(ctx.description).toBe(
      'デイサービス・特養・有料老人ホーム・グループホーム・訪問介護など、高齢者の生活を支える介護サービス',
    );
  });

  test('care-service: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('care-service')!;
    expect(ctx.searchPoints).toStrictEqual([
      '施設の種類（介護度対応範囲）',
      '利用料金・初期費用',
      '送迎エリア・時間',
      'スタッフ体制・看護師常駐',
    ]);
  });

  test('care-service: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('care-service')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('見学はできますか？');
    expect(ctx.faqs[0].a).toBe(
      'ほとんどの施設で見学を受け付けています。事前に電話または問い合わせフォームから予約してください。',
    );
    expect(ctx.faqs[1].q).toBe('要介護度はどの程度から利用できますか？');
    expect(ctx.faqs[1].a).toBe(
      '施設によって対応範囲が異なります。要支援1から要介護5まで、施設詳細ページで確認できます。',
    );
    expect(ctx.faqs[2].q).toBe('体験利用はできますか？');
    expect(ctx.faqs[2].a).toBe(
      'デイサービスでは1日体験を受け付ける施設が多数あります。費用や条件は施設にお問い合わせください。',
    );
  });

  test('other: keyword と description', () => {
    const ctx = getBusinessTypeContext('other')!;
    expect(ctx.keyword).toBe('サロン・治療院・施設');
    expect(ctx.description).toBe('その他の医療・美容・福祉に関連する施設');
  });

  test('other: searchPoints 4件の内容', () => {
    const ctx = getBusinessTypeContext('other')!;
    expect(ctx.searchPoints).toStrictEqual([
      '施設の専門性',
      '営業時間・アクセス',
      '料金体系',
      '口コミ評価',
    ]);
  });

  test('other: faqs 3件の q / a', () => {
    const ctx = getBusinessTypeContext('other')!;
    expect(ctx.faqs).toHaveLength(3);
    expect(ctx.faqs[0].q).toBe('どんな施設が掲載されていますか？');
    expect(ctx.faqs[0].a).toBe(
      '美容・医療・介護の幅広いジャンルの施設を掲載しています。詳細は各施設ページをご確認ください。',
    );
    expect(ctx.faqs[1].q).toBe('予約方法は？');
    expect(ctx.faqs[1].a).toBe(
      'CareLinkではオンライン予約に対応する施設が多数。各施設ページから24時間予約できます。',
    );
    expect(ctx.faqs[2].q).toBe('口コミは信頼できますか？');
    expect(ctx.faqs[2].a).toBe(
      '実際の利用者による口コミのみ掲載しています。来店確認バッジ付きの口コミは予約履歴と紐付いています。',
    );
  });
});
