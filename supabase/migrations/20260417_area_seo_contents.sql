-- area_seo_contents テーブル（v8.30）
-- エリアページのユニークSEOコンテンツ（都道府県×市区町村×業種の組み合わせ）
-- getAreaSeoContent() の4段階フォールバックチェーンで参照される

CREATE TABLE IF NOT EXISTS area_seo_contents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture_slug     TEXT NOT NULL,
  city_slug           TEXT,
  business_type_slug  TEXT,
  h2_title            TEXT,
  body_text           TEXT NOT NULL DEFAULT '',
  faq_items           JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- フォールバックチェーンのキーになる複合ユニーク制約
  UNIQUE (prefecture_slug, city_slug, business_type_slug)
);

-- NULL を含む UNIQUE 制約は各段ごとに部分インデックスで補完
-- (prefecture + city + type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_area_seo_pref_city_type
  ON area_seo_contents (prefecture_slug, city_slug, business_type_slug)
  WHERE city_slug IS NOT NULL AND business_type_slug IS NOT NULL;

-- (prefecture + city only)
CREATE UNIQUE INDEX IF NOT EXISTS uq_area_seo_pref_city
  ON area_seo_contents (prefecture_slug, city_slug)
  WHERE city_slug IS NOT NULL AND business_type_slug IS NULL;

-- (prefecture + type only)
CREATE UNIQUE INDEX IF NOT EXISTS uq_area_seo_pref_type
  ON area_seo_contents (prefecture_slug, business_type_slug)
  WHERE city_slug IS NULL AND business_type_slug IS NOT NULL;

-- (prefecture only)
CREATE UNIQUE INDEX IF NOT EXISTS uq_area_seo_pref_only
  ON area_seo_contents (prefecture_slug)
  WHERE city_slug IS NULL AND business_type_slug IS NULL;

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_area_seo_pref ON area_seo_contents (prefecture_slug);
CREATE INDEX IF NOT EXISTS idx_area_seo_city ON area_seo_contents (city_slug) WHERE city_slug IS NOT NULL;

-- RLS
ALTER TABLE area_seo_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "area_seo_public_read" ON area_seo_contents FOR SELECT USING (true);
CREATE POLICY "area_seo_admin_write" ON area_seo_contents FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  )
);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_area_seo_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_area_seo_updated_at
  BEFORE UPDATE ON area_seo_contents
  FOR EACH ROW EXECUTE FUNCTION update_area_seo_updated_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- シードデータ（主要都府県 × 業種）
-- ※ {{facility_count}} / {{avg_rating}} / {{area_name}} は enrichSeoContent() で動的置換
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ────────────────────────────────────────
-- 大阪府 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'osaka', NULL, NULL,
  '大阪府でサロン・クリニックをお探しの方へ',
  '<p>大阪府には美容サロン・鍼灸院・整骨院・エステなど、健康と美容に関わる施設が豊富に揃っています。CareLink では現在{{facility_count}}件の大阪府の施設を掲載しており、口コミ平均は{{avg_rating}}点（5点満点）です。</p>
<p>梅田・難波・天王寺などの繁華街から、豊中・吹田・堺などの住宅エリアまで、通いやすい立地の施設を地図やエリアナビで絞り込めます。24時間ネット予約対応の施設も多く、仕事帰りや休日にもスムーズに予約できます。</p>
<p>初めての方には施術内容・料金・スタッフ情報を詳しく掲載しています。口コミの来店確認バッジ付きレビューで、リアルな体験談を参考にしながらお気に入りの施設を見つけてください。</p>',
  '[
    {"question": "大阪府でネット予約できるサロンはありますか？", "answer": "CareLink に掲載している大阪府の施設の多くが24時間オンライン予約に対応しています。施設ページから空き状況をリアルタイムで確認し、そのまま予約を完了できます。"},
    {"question": "口コミはどのように信頼性を担保していますか？", "answer": "CareLink の口コミは実際に予約・来店した方のみが投稿できる「来店確認バッジ」制度を採用しています。虚偽の口コミを減らし、信頼性の高い情報を提供しています。"},
    {"question": "初回割引やクーポンはありますか？", "answer": "施設ごとに初回限定クーポンや期間限定割引を掲載しています。施設詳細ページの「クーポン」タブからご確認ください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 大阪府 × 鍼灸
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'osaka', NULL, 'shinkyuu',
  '大阪府の鍼灸院をお探しの方へ',
  '<p>大阪府内の鍼灸院は{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。肩こり・腰痛・自律神経の乱れ・不妊治療サポートなど、幅広い症状に対応した鍼灸院が揃っています。</p>
<p>鍼灸は東洋医学に基づき、ツボへの刺激で血行を促進し、体の自然治癒力を高める施術です。WHO（世界保健機関）が有効性を認めている症状も多く、肩こりや腰痛だけでなく、頭痛・冷え性・生理不順などにも対応している院があります。</p>
<p>初めて鍼灸を受ける方も安心できるよう、施術内容・料金・院の雰囲気を写真と口コミで詳しく紹介しています。「初回体験コース」を設けている院も多く、気軽に試してみることができます。</p>',
  '[
    {"question": "鍼灸は保険適用になりますか？", "answer": "一部の症状（神経痛・リウマチ・頸腕症候群・五十肩・腰痛症・頸椎捻挫後遺症）では医師の同意書があれば健康保険が使える場合があります。詳細は各鍼灸院にお問い合わせください。"},
    {"question": "初めて鍼灸を受けるのですが痛くないですか？", "answer": "鍼灸の鍼は注射針と異なり直径0.1〜0.3mm程度の細いものです。熟練した施術者なら痛みをほとんど感じない方がほとんどですが、ズーンとした「響き感」がある場合があります。不安な場合は事前にスタッフに相談してください。"},
    {"question": "何回通えば効果が出ますか？", "answer": "症状や体質によって個人差がありますが、一般的に3〜5回の施術で変化を実感される方が多いです。慢性的な症状ほど継続的なケアが効果的とされています。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 大阪府 × 整骨院
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'osaka', NULL, 'seikotsu',
  '大阪府の整骨院・接骨院をお探しの方へ',
  '<p>大阪府の整骨院・接骨院を{{facility_count}}件掲載しています（口コミ平均{{avg_rating}}点）。交通事故後のリハビリ・スポーツ障害・ぎっくり腰・寝違えなど急性の症状から、慢性的な肩こり・腰痛まで幅広く対応しています。</p>
<p>整骨院（接骨院）は柔道整復師の国家資格者が施術を行います。骨折・脱臼・捻挫・打撲・挫傷といった外傷性の症状には健康保険が適用される場合があります。</p>
<p>CareLink では各院のスタッフ紹介・施術メニュー・料金を詳しく掲載。口コミで実際の患者さんの声を確認してから来院できます。</p>',
  '[
    {"question": "整骨院と整形外科の違いは何ですか？", "answer": "整形外科は医師が診察・診断・投薬を行う医療機関です。整骨院（接骨院）は柔道整復師が骨折・脱臼・捻挫などの外傷に手技で対応します。症状が重篤な場合は整形外科への受診も検討してください。"},
    {"question": "交通事故後も整骨院に通えますか？", "answer": "交通事故による怪我の場合、自賠責保険や任意保険を使って整骨院に通院できるケースがほとんどです。まず事故後すぐに医師の診察を受け、その後整骨院への通院を検討することをおすすめします。"},
    {"question": "保険は使えますか？", "answer": "骨折・脱臼・捻挫・打撲・挫傷の急性外傷には健康保険が適用されます。慢性的な肩こりや疲労回復目的の施術には保険は適用されません。詳しくは来院時に確認してください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 大阪府 豊中市 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'osaka', 'toyonaka', NULL,
  '豊中市のサロン・クリニックをお探しの方へ',
  '<p>大阪府豊中市には美容サロン・鍼灸院・整骨院などの施設が{{facility_count}}件掲載されています（口コミ平均{{avg_rating}}点）。</p>
<p>豊中市は大阪市の北に隣接し、阪急宝塚線・神戸線・北大阪急行が通る交通の便がよい住宅都市です。蛍池・庄内・豊中・曽根・岡町など各駅周辺に生活に密着したサロン・クリニックが充実しています。</p>
<p>子育て世代や共働き家庭が多い豊中市では、産後ケアや自律神経調整を得意とする鍼灸院、スポーツ障害に強い整骨院なども多く、地域のニーズに応じた施設が揃っています。</p>',
  '[
    {"question": "豊中市で土日・夜間も営業しているサロンはありますか？", "answer": "CareLink では営業時間で絞り込み検索ができます。豊中市内にも土日営業・夜間対応の施設が多数あります。各施設のページで詳しい営業時間をご確認ください。"},
    {"question": "豊中市でネット予約できる施設はどのくらいありますか？", "answer": "CareLink に掲載している豊中市の施設の多くが24時間オンライン予約に対応しています。施設ページから空き状況を確認してそのまま予約できます。"},
    {"question": "豊中市で子連れでも行けるサロンはありますか？", "answer": "施設によっては子連れ歓迎・キッズスペースあり等の特徴を掲載しています。検索の「こだわり条件」やキーワード検索で「子連れ」「ベビーカー」などで絞り込んでみてください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 大阪府 豊中市 × 鍼灸
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'osaka', 'toyonaka', 'shinkyuu',
  '豊中市の鍼灸院をお探しの方へ',
  '<p>大阪府豊中市の鍼灸院を{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。肩こり・腰痛・不妊治療サポート・産後ケアなど、豊中市民の健康をサポートする鍼灸院が揃っています。</p>
<p>豊中市は大阪市のベッドタウンとして人気が高く、デスクワークによる肩こりや腰痛、育児疲れ・産後の体調管理など、現代的な健康課題を抱える方が多い地域です。鍼灸は薬を使わず体の自然治癒力を高める施術として、幅広い年代から支持されています。</p>
<p>CareLink では豊中市内の鍼灸院の施術内容・料金・院の雰囲気を写真付きで詳しく掲載。実際に来院した方の口コミ（来店確認バッジ付き）も参考にしながら、自分に合った鍼灸院を見つけてください。</p>',
  '[
    {"question": "豊中市で不妊治療に対応した鍼灸院はありますか？", "answer": "豊中市内にも不妊治療サポート・妊活に特化した鍼灸院があります。CareLink の検索で「不妊」「妊活」などのキーワードで絞り込んでみてください。"},
    {"question": "豊中市の鍼灸院の料金相場はどのくらいですか？", "answer": "初回施術は3,000〜8,000円程度が目安です（施術内容・院によって異なります）。CareLink では各院のメニューと料金を詳しく掲載していますので、事前に比較してからご予約ください。"},
    {"question": "産後の体調不良に鍼灸は効果がありますか？", "answer": "産後の腰痛・骨盤のゆがみ・疲労・冷え性・自律神経の乱れなどに鍼灸が効果的とされています。授乳中でも施術を受けられる院が多いですが、事前に院に相談することをおすすめします。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 東京都 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'tokyo', NULL, NULL,
  '東京都でサロン・クリニックをお探しの方へ',
  '<p>東京都には{{facility_count}}件のサロン・クリニックを掲載しています（口コミ平均{{avg_rating}}点）。渋谷・新宿・銀座・六本木などの都心エリアから、世田谷・杉並・練馬などの住宅地まで、幅広いエリアで施設を探せます。</p>
<p>東京都内は競争が激しい分、高水準のサービスを提供する施設が多く揃っています。最新の美容機器を導入したエステや、著名施術者が在籍する鍼灸院など、こだわりのある施設もCareLink で見つかります。</p>
<p>24時間ネット予約対応・当日予約OK・深夜営業など、忙しい東京在住の方のライフスタイルに合わせた施設も豊富です。</p>',
  '[
    {"question": "東京都内で当日予約できるサロンはありますか？", "answer": "CareLink では当日予約に対応している施設を多数掲載しています。空き状況はリアルタイムで更新されますので、施設ページからご確認ください。"},
    {"question": "東京都内で深夜まで営業しているサロンはありますか？", "answer": "都内には夜22時・23時まで営業している施設もあります。CareLink の検索で時間帯や営業時間で絞り込んでご確認ください。"},
    {"question": "外国語対応の施設はありますか？", "answer": "英語対応可能な施設も一部掲載しています。施設の特徴欄や口コミから「English OK」などの情報を確認できます。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 東京都 × 鍼灸
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'tokyo', NULL, 'shinkyuu',
  '東京都の鍼灸院をお探しの方へ',
  '<p>東京都内の鍼灸院を{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。スポーツ障害・不妊治療サポート・美容鍼・自律神経ケアなど、専門特化した鍼灸院が都内各所に揃っています。</p>
<p>東京では西洋医学のクリニックと東洋医学の鍼灸を組み合わせた統合的な健康管理が普及しており、アスリートや美容意識の高いビジネスパーソンにも鍼灸が選ばれています。</p>
<p>CareLink では各院の得意分野・施術方針・料金を詳しく掲載。「美容鍼」「スポーツ鍼灸」「不妊治療」などのキーワードで絞り込んで、自分の悩みに特化した鍼灸院を見つけてください。</p>',
  '[
    {"question": "東京で美容鍼を受けられる鍼灸院はありますか？", "answer": "東京都内には美容鍼（顔鍼）に特化した鍼灸院も多数あります。小顔・ハリ・むくみ改善などを目的として受ける方が増えています。CareLink の検索で「美容鍼」で絞り込んでみてください。"},
    {"question": "スポーツ鍼灸とはどんな施術ですか？", "answer": "スポーツ鍼灸は筋肉の疲労回復・スポーツ障害の改善・パフォーマンス向上を目的とした鍼灸です。アスリートや運動習慣がある方が多く利用しています。"},
    {"question": "鍼灸師の資格はどのようなものですか？", "answer": "はり師・きゅう師はそれぞれ国家資格です。3年以上の専門学校または大学での養成課程を経て国家試験に合格した方のみが施術できます。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 神奈川県 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'kanagawa', NULL, NULL,
  '神奈川県でサロン・クリニックをお探しの方へ',
  '<p>神奈川県のサロン・クリニックを{{facility_count}}件掲載（口コミ平均{{avg_rating}}点）。横浜・川崎・相模原などの都市部から、鎌倉・小田原・湘南エリアまで幅広く施設を探せます。</p>
<p>神奈川県は東京のベッドタウンとしてだけでなく、豊かな自然環境と都市機能が融合した生活環境が整っています。アクティブなライフスタイルを支えるスポーツ系の整骨院・鍼灸院から、リゾート気分で通えるエステサロンまで多彩です。</p>
<p>横浜・川崎エリアでは夜間・深夜営業の施設も充実。湘南エリアではゆったりとした雰囲気の施設が揃っています。</p>',
  '[
    {"question": "横浜市内で予約できる施設はどのくらいありますか？", "answer": "CareLink では横浜市内の多数の施設を掲載しています。エリア（市区町村）で絞り込んで探してみてください。"},
    {"question": "湘南エリアでのびのびと施術を受けられるサロンはありますか？", "answer": "鎌倉・藤沢・茅ヶ崎などの湘南エリアにも施設を掲載しています。落ち着いた環境でリラックスできるサロンを口コミと写真で比較してください。"},
    {"question": "川崎で仕事帰りに寄れる施設はありますか？", "answer": "川崎駅・武蔵小杉などの主要駅周辺には、20時・21時以降も営業している施設があります。CareLink の検索で夜間営業で絞り込んでください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 愛知県 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'aichi', NULL, NULL,
  '愛知県でサロン・クリニックをお探しの方へ',
  '<p>愛知県のサロン・クリニックを{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。名古屋市内の栄・名駅・大須エリアから、豊田・岡崎・春日井などの周辺都市まで施設を探せます。</p>
<p>愛知県は製造業が盛んな地域柄、体を使う仕事による腰痛・肩こりのケアを求める方が多く、整骨院・鍼灸院が充実しています。名古屋市内には美容意識の高いエステ・美容サロンも多数揃っています。</p>',
  '[
    {"question": "名古屋市内で評判の良いサロンを探しています。", "answer": "CareLink では口コミ評価が高い順に並べ替えて検索できます。名古屋市で業種を絞り込んで「評価が高い順」で探してみてください。"},
    {"question": "愛知県でスポーツ障害に対応した整骨院はありますか？", "answer": "愛知県内には柔道・野球・サッカーなどのスポーツ障害に特化した整骨院もあります。施設のこだわり条件や口コミのキーワードで「スポーツ」で絞り込んでみてください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 福岡県 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'fukuoka', NULL, NULL,
  '福岡県でサロン・クリニックをお探しの方へ',
  '<p>福岡県のサロン・クリニックを{{facility_count}}件掲載しています（口コミ平均{{avg_rating}}点）。博多・天神・小倉などの主要エリアから、糸島・久留米・北九州など幅広いエリアで施設を探せます。</p>
<p>福岡市は全国でも住みやすい都市として知名度が高く、若い世代や移住者も多い活気ある街です。トレンドに敏感なエステ・美容サロン・鍼灸院が集まり、比較的リーズナブルな料金でサービスを受けられる施設も多いのが特徴です。</p>',
  '[
    {"question": "天神・博多エリアで通いやすいサロンはどこで探せますか？", "answer": "CareLink の市区町村検索から「福岡市中央区」「福岡市博多区」などで絞り込んで探せます。"},
    {"question": "福岡で美容系サロンのクーポンを探しています。", "answer": "施設のクーポンタブから初回割引や期間限定クーポンを確認できます。お気に入り登録をすると新着クーポンの通知も受け取れます。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 兵庫県 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'hyogo', NULL, NULL,
  '兵庫県でサロン・クリニックをお探しの方へ',
  '<p>兵庫県のサロン・クリニックを{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。神戸・三宮・西宮・尼崎などの阪神エリアから、明石・姫路・西脇など県内各地の施設を探せます。</p>
<p>神戸市はおしゃれなカフェやショップが並ぶ街として有名で、美容・エステ・鍼灸サロンもトレンドに敏感な施設が揃っています。阪急・阪神・JRの各駅周辺に通いやすい施設が多く、大阪からも通院しやすい立地の院も多数あります。</p>',
  '[
    {"question": "神戸市内で評判の良いエステサロンを探すには？", "answer": "CareLink の検索で神戸市を選択し、業種「エステ」で絞り込んでください。口コミ評価順・件数順で並べ替えて比較できます。"},
    {"question": "西宮・芦屋エリアの施設も探せますか？", "answer": "はい。CareLink では西宮市・芦屋市の施設も掲載しています。エリア検索から市区町村を選択してください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 京都府 汎用
-- ────────────────────────────────────────
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'kyoto', NULL, NULL,
  '京都府でサロン・クリニックをお探しの方へ',
  '<p>京都府のサロン・クリニックを{{facility_count}}件掲載（口コミ平均{{avg_rating}}点）。四条・烏丸・河原町などの繁華街から、伏見・山科・宇治など各エリアの施設を探せます。</p>
<p>古都・京都ならではの落ち着いた町家や洗練された空間でリラクゼーションを提供するサロンも多く、観光と組み合わせて利用する方にも人気です。伝統的な和の美容法を取り入れた施術や、厳選素材を使ったエステなど、京都らしいこだわりの施設も揃っています。</p>',
  '[
    {"question": "京都市内で観光の合間に立ち寄れるサロンはありますか？", "answer": "四条・河原町周辺には観光エリアからアクセスしやすいサロンも掲載しています。当日予約対応の施設も多くあります。"},
    {"question": "京都で伝統的な美容法を体験できる施設はありますか？", "answer": "CareLink の施設詳細ページやこだわり条件で「和のケア」「天然成分」などのキーワードで検索してみてください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────
-- 全国汎用 × 鍼灸（未登録の都道府県のフォールバック用ではなく業種全般テンプレ）
-- ※ 都道府県ページでは prefecture_slug が一致しないため不要、各都道府県に追加するのが正式
-- → 代わりに北海道・埼玉・千葉を追加
-- ────────────────────────────────────────

-- 埼玉県 汎用
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'saitama', NULL, NULL,
  '埼玉県でサロン・クリニックをお探しの方へ',
  '<p>埼玉県のサロン・クリニックを{{facility_count}}件掲載中（口コミ平均{{avg_rating}}点）。大宮・浦和・川越・所沢・春日部などの主要都市から各エリアの施設を探せます。</p>
<p>埼玉県は都内へのアクセスが良好な住宅都市として人気が高く、子育て世代やビジネスパーソンが多く暮らしています。産後ケアや骨盤矯正、疲労回復を目的とした施術の需要が高いエリアです。</p>',
  '[
    {"question": "大宮・浦和エリアで評判の整骨院はありますか？", "answer": "CareLink では大宮・浦和の施設を掲載しています。市区町村で絞り込んで、口コミ評価順で比較してみてください。"},
    {"question": "埼玉県で土日も診てもらえる鍼灸院はありますか？", "answer": "土日営業の施設も多く掲載しています。施設ページの営業時間をご確認の上、オンラインでご予約ください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- 千葉県 汎用
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'chiba', NULL, NULL,
  '千葉県でサロン・クリニックをお探しの方へ',
  '<p>千葉県のサロン・クリニックを{{facility_count}}件掲載（口コミ平均{{avg_rating}}点）。千葉市・船橋・松戸・柏・市川など各都市の施設を探せます。</p>
<p>千葉県は東京都心へのアクセスが良い住宅エリアが多く、デスクワークや通勤ラッシュによる体の疲れをケアするニーズが高い地域です。地域密着型の整骨院・鍼灸院が充実しています。</p>',
  '[
    {"question": "船橋・市川エリアでネット予約できるサロンはありますか？", "answer": "CareLink では船橋市・市川市の施設も掲載しています。エリア検索から絞り込んでオンライン予約ができます。"},
    {"question": "千葉県で女性スタッフが対応してくれるサロンはありますか？", "answer": "施設の特徴や口コミに「女性スタッフ」情報が記載されている場合があります。施設詳細ページのスタッフ紹介も参考にしてください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

-- 北海道 汎用
INSERT INTO area_seo_contents (prefecture_slug, city_slug, business_type_slug, h2_title, body_text, faq_items)
VALUES (
  'hokkaido', NULL, NULL,
  '北海道でサロン・クリニックをお探しの方へ',
  '<p>北海道のサロン・クリニックを{{facility_count}}件掲載しています（口コミ平均{{avg_rating}}点）。札幌・旭川・函館・釧路・帯広など各地域の施設を探せます。</p>
<p>北海道は寒冷な気候から冷え性・関節痛・自律神経の乱れに悩む方が多く、温かみのある施術を提供する鍼灸院や整骨院が地域に根ざしています。農業・漁業・建設など体を使う仕事をされている方のリカバリーニーズも高いエリアです。</p>',
  '[
    {"question": "札幌市内でおすすめのサロンを探すには？", "answer": "CareLink の市区町村検索で「札幌市中央区」「札幌市北区」などに絞り込んで探せます。口コミ評価順での比較もできます。"},
    {"question": "北海道の冬の寒さからくる体の不調に対応した施設はありますか？", "answer": "冷え性・関節痛・自律神経ケアを得意とする鍼灸院も多数掲載しています。施設の得意分野や口コミを参考にしてください。"}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;
