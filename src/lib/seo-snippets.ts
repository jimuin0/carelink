/**
 * SEO スニペット生成器
 * - 都道府県×業種、市区町村×業種、市区町村単体ページの固有テキスト生成
 * - prefSeoData + businessTypeContext を組み合わせて事実ベースで文を構築
 * - 376＋283＋多数の組合せで全て差別化された本文・H2・FAQを生成
 */

import { getPrefectureSeo } from '@/data/prefecture-seo';
import { getPrefectureName, getBusinessTypeName } from '@/lib/seo-constants';

interface BusinessTypeContext {
  keyword: string;
  description: string;
  searchPoints: string[];
  faqs: { q: string; a: string }[];
}

const businessTypeContext: Record<string, BusinessTypeContext> = {
  'hair-salon': {
    keyword: 'ヘアサロン・美容室',
    description: 'カット・カラー・パーマ・縮毛矯正・ヘッドスパなど、ヘアスタイル全般のメニューを提供する美容室',
    searchPoints: ['口コミ評価が高いスタイリスト', '駅近・駐車場ありの利便性', 'カラー・縮毛矯正の技術力', 'クーポン・初回割引の有無'],
    faqs: [
      { q: '指名予約は可能ですか？', a: 'はい、CareLink では指名スタッフを選んで予約できます。スタイリストのプロフィール・実績写真も確認できます。' },
      { q: 'カラー・縮毛矯正のクーポンはありますか？', a: '各サロンが独自にクーポンを掲載しています。サロン詳細ページからクーポン一覧をチェックしてください。' },
      { q: '当日予約はできますか？', a: '空き枠があれば当日予約も可能です。予約カレンダーで○表示の時間帯から選べます。' },
    ],
  },
  'nail-eyelash': {
    keyword: 'ネイル・まつげサロン',
    description: 'ジェルネイル・スカルプ・まつげエクステ・まつげパーマなど指先と目元の美容を専門とするサロン',
    searchPoints: ['ジェル・スカルプの技術力', 'デザインバリエーション', 'マツエクの種類（フラットラッシュ・ボリュームラッシュ等）', '衛生管理・施術時間'],
    faqs: [
      { q: 'ネイルとまつげを同時に予約できますか？', a: '両方対応のサロンなら同時予約可能です。複数メニュー予約に対応しているサロンを選んでください。' },
      { q: 'マツエクのオフ料金はかかりますか？', a: 'サロンによります。メニューに「オフ込み」「オフ別」の表記があるので事前に確認できます。' },
      { q: 'ネイルデザインのサンプル写真は見られますか？', a: 'はい、サロン詳細ページのカタログから施術事例の写真を確認できます。' },
    ],
  },
  relaxation: {
    keyword: 'リラクゼーションサロン',
    description: 'もみほぐし・リフレ・アロマ・タイ古式・ヘッドスパなど癒し系の施術を提供するリラクサロン',
    searchPoints: ['揉み返しの少ない技術', 'コース時間（60分・90分・120分）', '完全個室の有無', '深夜・早朝営業'],
    faqs: [
      { q: '何分コースがおすすめですか？', a: '初回は60分コース、肩こり・腰痛が辛い方は90分以上がおすすめです。' },
      { q: 'カップルで一緒に施術を受けられますか？', a: 'ペアルームのあるサロンなら可能です。サロン詳細の設備情報をご確認ください。' },
      { q: '揉み返しが心配です', a: '初回カウンセリングで強さの希望を伝えられます。口コミで施術の強さに関する評価もチェックできます。' },
    ],
  },
  esthetic: {
    keyword: 'エステサロン',
    description: 'フェイシャル・ボディ・痩身・脱毛・小顔矯正など美容全般を提供するエステティックサロン',
    searchPoints: ['機材（ハイフ・キャビ・ラジオ波等）', '初回体験の価格', '勧誘の有無の口コミ', 'コース・回数券の柔軟性'],
    faqs: [
      { q: '初回体験のみで通えますか？', a: 'はい、CareLinkでは口コミで「勧誘なし」と評価されているサロンも多数掲載しています。' },
      { q: 'メンズエステも検索できますか？', a: 'メンズ対応サロンも掲載しています。サロン詳細の対応性別をご確認ください。' },
      { q: '効果はどのくらいで実感できますか？', a: 'メニューや個人差によりますが、フェイシャルは1回、痩身は3-5回程度で実感する方が多いです。' },
    ],
  },
  'beauty-clinic': {
    keyword: '美容クリニック・美容皮膚科',
    description: '医師による医療美容を提供する美容クリニック・美容皮膚科。レーザー治療・注入治療・医療脱毛など',
    searchPoints: ['医師の経歴・症例数', 'カウンセリング無料の有無', '麻酔・アフターケアの体制', '料金の明朗さ'],
    faqs: [
      { q: 'カウンセリングだけでも受けられますか？', a: 'ほとんどのクリニックで無料カウンセリングを実施しています。予約時に「カウンセリング希望」とお伝えください。' },
      { q: '医療脱毛とエステ脱毛の違いは？', a: '医療脱毛はレーザーで毛根を破壊するため永久脱毛効果があります。エステ脱毛は減毛・抑毛が中心です。' },
      { q: '支払い方法は？', a: '現金・クレジット・医療ローンに対応するクリニックが多数。詳細は各クリニックのページをご確認ください。' },
    ],
  },
  acupuncture: {
    keyword: '鍼灸院・整骨院・接骨院',
    description: '鍼・灸・整体・骨格矯正・スポーツ外傷・交通事故対応など、東洋医学と手技療法を提供する治療院',
    searchPoints: ['国家資格保持者の在籍', '保険適用メニューの有無', '交通事故・労災対応', '症状（腰痛・肩こり・坐骨神経痛等）への対応実績'],
    faqs: [
      { q: '保険は適用されますか？', a: '急性の捻挫・打撲・挫傷などは健康保険適用になります。慢性的な肩こり・疲労は自費診療です。' },
      { q: '交通事故のむち打ちにも対応していますか？', a: '交通事故対応の整骨院では自賠責保険を使った治療が可能です。施設詳細で交通事故対応の有無を確認できます。' },
      { q: '鍼は痛くないですか？', a: '使用する鍼は髪の毛ほどの細さで、ほとんど痛みを感じません。鍼が苦手な方には灸や手技のみの対応も可能です。' },
    ],
  },
  'care-service': {
    keyword: '介護施設・デイサービス',
    description: 'デイサービス・特養・有料老人ホーム・グループホーム・訪問介護など、高齢者の生活を支える介護サービス',
    searchPoints: ['施設の種類（介護度対応範囲）', '利用料金・初期費用', '送迎エリア・時間', 'スタッフ体制・看護師常駐'],
    faqs: [
      { q: '見学はできますか？', a: 'ほとんどの施設で見学を受け付けています。事前に電話または問い合わせフォームから予約してください。' },
      { q: '要介護度はどの程度から利用できますか？', a: '施設によって対応範囲が異なります。要支援1から要介護5まで、施設詳細ページで確認できます。' },
      { q: '体験利用はできますか？', a: 'デイサービスでは1日体験を受け付ける施設が多数あります。費用や条件は施設にお問い合わせください。' },
    ],
  },
  other: {
    keyword: 'サロン・治療院・施設',
    description: 'その他の医療・美容・福祉に関連する施設',
    searchPoints: ['施設の専門性', '営業時間・アクセス', '料金体系', '口コミ評価'],
    faqs: [
      { q: 'どんな施設が掲載されていますか？', a: '美容・医療・介護の幅広いジャンルの施設を掲載しています。詳細は各施設ページをご確認ください。' },
      { q: '予約方法は？', a: 'CareLinkではオンライン予約に対応する施設が多数。各施設ページから24時間予約できます。' },
      { q: '口コミは信頼できますか？', a: '実際の利用者による口コミのみ掲載しています。来店確認バッジ付きの口コミは予約履歴と紐付いています。' },
    ],
  },
};

export interface GeneratedSeoContent {
  h2: string;
  intro: string;
  highlights: string[];
  faqs: { question: string; answer: string }[];
}

export function getBusinessTypeContext(typeSlug: string): BusinessTypeContext | null {
  return businessTypeContext[typeSlug] ?? null;
}

/**
 * 都道府県 × 業種 ページの固有SEOコンテンツ生成
 * 例: /tokyo/hair-salon
 */
export function generatePrefTypeContent(
  prefectureSlug: string,
  typeSlug: string
): GeneratedSeoContent | null {
  const prefName = getPrefectureName(prefectureSlug);
  const typeName = getBusinessTypeName(typeSlug);
  const prefSeo = getPrefectureSeo(prefectureSlug);
  const typeCtx = businessTypeContext[typeSlug];

  if (!prefName || !typeName || !typeCtx) return null;

  const prefIntroShort = prefSeo
    ? prefSeo.intro.replace(/CareLink[^。]*。/g, '').slice(0, 180)
    : `${prefName}は医療・美容・福祉施設が広く点在するエリアです。`;

  const intro = `${prefName}の${typeName}（${typeCtx.keyword}）をお探しなら CareLink。${prefIntroShort} CareLinkでは${prefName}全域の${typeName}を口コミ・メニュー・写真で比較し、24時間ネット予約が可能です。${typeCtx.description}を、地域・予算・目的に合わせて選べます。`;

  const highlights = [
    `${prefName}全域の${typeName}を網羅`,
    ...typeCtx.searchPoints.slice(0, 3),
  ];

  const faqs: { question: string; answer: string }[] = [
    {
      question: `${prefName}でおすすめの${typeName}は？`,
      answer: `CareLinkでは${prefName}の${typeName}を口コミ評価順・料金順・新着順で並び替えできます。お住まいのエリアと予算に合った${typeName}が見つかります。`,
    },
    ...typeCtx.faqs.slice(0, 2).map((f) => ({ question: f.q, answer: f.a })),
  ];

  return {
    h2: `${prefName}で${typeName}をお探しの方へ`,
    intro,
    highlights,
    faqs,
  };
}

/**
 * 都道府県 × 市区町村 ページの固有SEOコンテンツ生成
 * 例: /osaka/toyonaka
 */
export function generateCityContent(
  prefectureSlug: string,
  cityName: string
): GeneratedSeoContent | null {
  const prefName = getPrefectureName(prefectureSlug);
  const prefSeo = getPrefectureSeo(prefectureSlug);
  if (!prefName) return null;

  const regionContext = prefSeo
    ? prefSeo.intro.split('。')[0] + '。'
    : '';

  const intro = `${prefName}${cityName}の美容サロン・鍼灸院・整骨院・介護施設をお探しなら CareLink。${regionContext}${cityName}にはヘアサロン・ネイル・エステ・整骨院・美容クリニック・介護施設など多様な業種が集まっています。CareLinkでは${cityName}全域の施設を口コミ・メニュー・写真で比較し、24時間ネット予約が可能です。`;

  const highlights = [
    `${cityName}内のヘアサロン・美容室を網羅`,
    `${cityName}内のネイル・まつげサロン`,
    `${cityName}内のエステ・リラクサロン`,
    `${cityName}内の鍼灸院・整骨院`,
    `${cityName}内の美容クリニック・介護施設`,
  ];

  const faqs = [
    {
      question: `${cityName}で人気のサロンは？`,
      answer: `CareLinkでは${cityName}の施設を口コミ評価順に並び替え可能です。地域住民の評価が高い人気施設をチェックできます。`,
    },
    {
      question: `${cityName}内で当日予約できる施設は？`,
      answer: `予約カレンダーで「○」表示の時間帯から当日予約が可能です。空き状況はリアルタイムで反映されます。`,
    },
    {
      question: `${cityName}周辺エリアの施設も検索できますか？`,
      answer: `はい、${prefName}内の隣接市区町村の施設もエリア検索や地図検索から見つけられます。`,
    },
  ];

  return {
    h2: `${cityName}でサロン・クリニックをお探しの方へ`,
    intro,
    highlights,
    faqs,
  };
}

/**
 * 市区町村 × 業種 ページの固有SEOコンテンツ生成
 * 例: /osaka/toyonaka/hair-salon
 */
export function generateCityTypeContent(
  prefectureSlug: string,
  cityName: string,
  typeSlug: string
): GeneratedSeoContent | null {
  const prefName = getPrefectureName(prefectureSlug);
  const typeName = getBusinessTypeName(typeSlug);
  const typeCtx = businessTypeContext[typeSlug];
  if (!prefName || !typeName || !typeCtx) return null;

  const intro = `${prefName}${cityName}の${typeName}（${typeCtx.keyword}）をお探しなら CareLink。${cityName}にある${typeName}を口コミ評価・メニュー・料金・写真で比較し、24時間ネット予約が可能です。${typeCtx.description}を、地元${cityName}で見つけられます。CareLinkは掲載・利用すべて無料、来店確認バッジ付きの信頼できる口コミだけを掲載しています。`;

  const highlights = [
    `${cityName}の${typeName}を全件掲載`,
    ...typeCtx.searchPoints.slice(0, 3),
  ];

  const faqs = [
    {
      question: `${cityName}で${typeName}を選ぶポイントは？`,
      answer: `${typeCtx.searchPoints.slice(0, 2).join('、')}などをチェックすると失敗しにくくなります。CareLinkの口コミ・写真・料金比較を活用してください。`,
    },
    ...typeCtx.faqs.slice(0, 2).map((f) => ({ question: f.q, answer: f.a })),
  ];

  return {
    h2: `${cityName}で${typeName}をお探しの方へ`,
    intro,
    highlights,
    faqs,
  };
}
