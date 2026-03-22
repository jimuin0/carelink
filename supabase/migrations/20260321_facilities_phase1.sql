-- =============================================
-- CareLink Phase 1: 施設検索サイト
-- テーブル + RLS + ダミーデータ
-- =============================================

-- 1. facility_profiles テーブル
CREATE TABLE IF NOT EXISTS facility_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  business_type TEXT NOT NULL,
  catch_copy TEXT,
  description TEXT,
  postal_code TEXT,
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  building TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  access_info TEXT,
  phone TEXT,
  website_url TEXT,
  business_hours JSONB,
  regular_holiday TEXT,
  seat_count INT,
  staff_count INT,
  parking BOOLEAN DEFAULT false,
  credit_card BOOLEAN DEFAULT false,
  features TEXT[] DEFAULT '{}',
  rating_avg NUMERIC(2,1) DEFAULT 0,
  rating_count INT DEFAULT 0,
  main_photo_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','suspended'))
);

CREATE INDEX IF NOT EXISTS idx_facility_profiles_status ON facility_profiles(status);
CREATE INDEX IF NOT EXISTS idx_facility_profiles_business_type ON facility_profiles(business_type);
CREATE INDEX IF NOT EXISTS idx_facility_profiles_prefecture ON facility_profiles(prefecture);
CREATE INDEX IF NOT EXISTS idx_facility_profiles_slug ON facility_profiles(slug);

ALTER TABLE facility_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published" ON facility_profiles FOR SELECT TO anon USING (status = 'published');

-- 2. facility_menus テーブル
CREATE TABLE IF NOT EXISTS facility_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INT,
  price_note TEXT,
  duration_minutes INT,
  is_featured BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_menus_facility ON facility_menus(facility_id);

ALTER TABLE facility_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read menus" ON facility_menus FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM facility_profiles WHERE id = facility_menus.facility_id AND status = 'published'));

-- 3. facility_photos テーブル
CREATE TABLE IF NOT EXISTS facility_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('main','interior','exterior','staff','menu','other')),
  caption TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_photos_facility ON facility_photos(facility_id);

ALTER TABLE facility_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read photos" ON facility_photos FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM facility_profiles WHERE id = facility_photos.facility_id AND status = 'published'));

-- =============================================
-- ダミーデータ（10施設）
-- =============================================

-- 1. HAL eyelash salon 堺東店
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'HAL eyelash salon 堺東店',
  'hal-eyelash-sakai',
  '美容サロン・アイラッシュ',
  '堺東駅徒歩3分｜まつ毛のプロが叶える理想の目元',
  '堺東駅から徒歩3分のアイラッシュ専門サロン。経験10年以上のアイリストが在籍し、マツエク・まつげパーマ・眉毛デザインまでトータルアイケアをご提供。完全個室・衛生管理徹底で安心の施術をお約束します。一人ひとりの目元に合わせたオーダーメイドデザインで、理想の目元を実現します。',
  '5900028', '大阪府', '堺市堺区', '三国ヶ丘御幸通1-1',
  '南海高野線 堺東駅 西口 徒歩3分',
  '072-123-4567',
  '{"mon": {"open": "10:00", "close": "20:00"}, "tue": {"open": "10:00", "close": "20:00"}, "wed": null, "thu": {"open": "10:00", "close": "20:00"}, "fri": {"open": "10:00", "close": "20:00"}, "sat": {"open": "09:00", "close": "19:00"}, "sun": {"open": "09:00", "close": "18:00"}}',
  '毎週水曜日', 4, 3, false, true,
  ARRAY['個室あり','当日予約OK','クレジットカード可'],
  4.7, 48,
  'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=500&fit=crop',
  'published'
);

-- 2. hair design BLOOM 難波店
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'hair design BLOOM 難波店',
  'hair-bloom-namba',
  '美容サロン・アイラッシュ',
  '難波駅1分｜トレンド×似合わせの大人カジュアルサロン',
  'なんば駅から徒歩1分の好立地ヘアサロン。トレンドを取り入れながら、一人ひとりの骨格・髪質に合わせた「似合わせカット」が人気。カラーは肌色診断をもとにしたパーソナルカラー提案。オーガニック製品を使用した頭皮ケアメニューも充実しています。',
  '5420076', '大阪府', '大阪市中央区', '難波1-2-3',
  '地下鉄御堂筋線 なんば駅 徒歩1分',
  '06-1234-5678',
  '{"mon": {"open": "10:00", "close": "21:00"}, "tue": {"open": "10:00", "close": "21:00"}, "wed": {"open": "10:00", "close": "21:00"}, "thu": {"open": "10:00", "close": "21:00"}, "fri": {"open": "10:00", "close": "21:00"}, "sat": {"open": "09:00", "close": "20:00"}, "sun": {"open": "09:00", "close": "19:00"}}',
  '不定休', 6, 5, false, true,
  ARRAY['当日予約OK','クレジットカード可','深夜営業'],
  4.5, 92,
  'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&h=500&fit=crop',
  'published'
);

-- 3. からだ鍼灸院 本町
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'からだ鍼灸院 本町',
  'karada-shinkyuin-honmachi',
  '鍼灸院',
  '本町駅直結｜女性鍼灸師による女性のための鍼灸院',
  '本町駅直結の女性専用鍼灸院。女性鍼灸師のみが在籍し、肩こり・腰痛から美容鍼・不妊治療まで幅広く対応。完全個室でリラックスできる空間をご提供。鍼が初めての方にも丁寧なカウンセリングで安心の施術を行います。',
  '5410053', '大阪府', '大阪市中央区', '本町2-3-4 本町ビル5F',
  '地下鉄御堂筋線 本町駅 直結',
  '06-2345-6789',
  '{"mon": {"open": "09:00", "close": "19:00"}, "tue": {"open": "09:00", "close": "19:00"}, "wed": {"open": "09:00", "close": "19:00"}, "thu": {"open": "09:00", "close": "19:00"}, "fri": {"open": "09:00", "close": "19:00"}, "sat": {"open": "10:00", "close": "17:00"}, "sun": null}',
  '日曜・祝日', 3, 3, false, true,
  ARRAY['個室あり','女性専用','クレジットカード可','初回カウンセリング無料'],
  4.8, 35,
  'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=500&fit=crop',
  'published'
);

-- 4. すこやか鍼灸整体院 天王寺
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'すこやか鍼灸整体院 天王寺',
  'sukoyaka-tennoji',
  '鍼灸院',
  '天王寺駅5分｜鍼灸×整体で根本改善',
  '天王寺駅から徒歩5分。鍼灸と整体を組み合わせた独自メソッドで、肩こり・腰痛・頭痛などの根本原因にアプローチ。スポーツ障害や産後ケアにも対応。国家資格保有の施術者が丁寧にカウンセリングし、オーダーメイドの施術プランをご提案します。',
  '5430055', '大阪府', '大阪市天王寺区', '悲田院町5-6',
  'JR天王寺駅 北口 徒歩5分',
  '06-3456-7890',
  '{"mon": {"open": "09:00", "close": "20:00"}, "tue": {"open": "09:00", "close": "20:00"}, "wed": {"open": "09:00", "close": "20:00"}, "thu": null, "fri": {"open": "09:00", "close": "20:00"}, "sat": {"open": "09:00", "close": "18:00"}, "sun": {"open": "09:00", "close": "18:00"}}',
  '毎週木曜日', 4, 2, true, true,
  ARRAY['駐車場あり','クレジットカード可','保険適用','バリアフリー'],
  4.6, 28,
  'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=800&h=500&fit=crop',
  'published'
);

-- 5. さくら整骨院 梅田
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'さくら整骨院 梅田',
  'sakura-seikotsuin-umeda',
  '整骨院',
  '梅田駅3分｜骨盤矯正・姿勢改善の専門院',
  '梅田駅から徒歩3分の整骨院。骨盤矯正・姿勢改善を専門とし、デスクワークによる肩こり・腰痛にお悩みの方に最適。独自の「3Dバランス矯正」で体のゆがみを根本から改善します。交通事故治療・スポーツ外傷にも対応。各種保険取扱い。',
  '5300001', '大阪府', '大阪市北区', '梅田1-5-6',
  'JR大阪駅 中央口 徒歩3分',
  '06-4567-8901',
  '{"mon": {"open": "08:30", "close": "20:00"}, "tue": {"open": "08:30", "close": "20:00"}, "wed": {"open": "08:30", "close": "20:00"}, "thu": {"open": "08:30", "close": "20:00"}, "fri": {"open": "08:30", "close": "20:00"}, "sat": {"open": "09:00", "close": "17:00"}, "sun": null}',
  '日曜・祝日', 5, 4, false, false,
  ARRAY['早朝営業','保険適用','当日予約OK'],
  4.4, 67,
  'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&h=500&fit=crop',
  'published'
);

-- 6. スポーツ整骨院アクティブ 心斎橋
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'スポーツ整骨院アクティブ 心斎橋',
  'active-seikotsuin-shinsaibashi',
  '整骨院',
  '心斎橋駅2分｜アスリートも通うスポーツ整骨院',
  '心斎橋駅から徒歩2分。プロスポーツ選手のケアも行うスポーツ整骨院。スポーツ障害の治療・パフォーマンス向上・ケガの予防まで、最新の設備と技術でサポート。一般の方の肩こり・腰痛治療も承ります。完全予約制で待ち時間なし。',
  '5420085', '大阪府', '大阪市中央区', '心斎橋筋2-7-8',
  '地下鉄御堂筋線 心斎橋駅 徒歩2分',
  '06-5678-9012',
  '{"mon": {"open": "10:00", "close": "21:00"}, "tue": {"open": "10:00", "close": "21:00"}, "wed": {"open": "10:00", "close": "21:00"}, "thu": {"open": "10:00", "close": "21:00"}, "fri": {"open": "10:00", "close": "21:00"}, "sat": {"open": "10:00", "close": "18:00"}, "sun": null}',
  '日曜日', 6, 4, false, true,
  ARRAY['クレジットカード可','深夜営業','当日予約OK'],
  4.3, 41,
  'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=500&fit=crop',
  'published'
);

-- 7. デイサービスひまわり 堺中区
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'デイサービスひまわり 堺中区',
  'day-service-himawari-sakai',
  '介護施設・デイサービス',
  '笑顔あふれる毎日を｜少人数制のアットホームなデイサービス',
  '堺市中区の閑静な住宅街にある定員18名の小規模デイサービス。一人ひとりに寄り添った個別ケアプランで、機能訓練・入浴・食事・レクリエーションをご提供。管理栄養士による手作りの食事が好評。送迎あり・介護保険適用。見学随時受付中。',
  '5990021', '大阪府', '堺市中区', '楢葉7-8',
  '泉北高速鉄道 深井駅 車10分（送迎あり）',
  '072-234-5678',
  '{"mon": {"open": "08:30", "close": "17:30"}, "tue": {"open": "08:30", "close": "17:30"}, "wed": {"open": "08:30", "close": "17:30"}, "thu": {"open": "08:30", "close": "17:30"}, "fri": {"open": "08:30", "close": "17:30"}, "sat": {"open": "08:30", "close": "17:30"}, "sun": null}',
  '日曜・年末年始', 18, 8, true, false,
  ARRAY['駐車場あり','送迎あり','バリアフリー','保険適用'],
  4.5, 15,
  'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=800&h=500&fit=crop',
  'published'
);

-- 8. ケアホームやすらぎ 東大阪
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  'ケアホームやすらぎ 東大阪',
  'care-home-yasuragi-higashiosaka',
  '介護施設・デイサービス',
  '「第二のわが家」をめざして｜24時間体制の安心ケア',
  '東大阪市にある住宅型有料老人ホーム。24時間介護スタッフ常駐で、日常生活のサポートから医療連携まで安心の体制。季節の行事やレクリエーションも充実。ご家族の面会は毎日可能。まずはお気軽に見学にお越しください。',
  '5770000', '大阪府', '東大阪市', '長堂1-2-3',
  '近鉄奈良線 布施駅 徒歩8分',
  '06-6789-0123',
  '{"mon": {"open": "00:00", "close": "23:59"}, "tue": {"open": "00:00", "close": "23:59"}, "wed": {"open": "00:00", "close": "23:59"}, "thu": {"open": "00:00", "close": "23:59"}, "fri": {"open": "00:00", "close": "23:59"}, "sat": {"open": "00:00", "close": "23:59"}, "sun": {"open": "00:00", "close": "23:59"}}',
  '年中無休', 30, 15, true, false,
  ARRAY['駐車場あり','バリアフリー','年中無休','送迎あり','訪問対応可'],
  4.2, 12,
  'https://images.unsplash.com/photo-1586105251261-72a756497a11?w=800&h=500&fit=crop',
  'published'
);

-- 9. 内科・皮膚科クリニック さかい
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  '内科・皮膚科クリニック さかい',
  'naika-hifuka-clinic-sakai',
  '病院・クリニック',
  '堺東駅すぐ｜内科・皮膚科のかかりつけ医',
  '堺東駅すぐの一般内科・皮膚科クリニック。風邪・生活習慣病から皮膚トラブルまで、お子様からご高齢の方まで幅広く対応。各種健康診断・予防接種も実施。電子カルテ導入で待ち時間の短縮に努めています。Web予約も対応。',
  '5900028', '大阪府', '堺市堺区', '三国ヶ丘御幸通3-2-1',
  '南海高野線 堺東駅 徒歩2分',
  '072-345-6789',
  '{"mon": {"open": "09:00", "close": "18:00"}, "tue": {"open": "09:00", "close": "18:00"}, "wed": {"open": "09:00", "close": "12:00"}, "thu": {"open": "09:00", "close": "18:00"}, "fri": {"open": "09:00", "close": "18:00"}, "sat": {"open": "09:00", "close": "13:00"}, "sun": null}',
  '日曜・祝日、水曜午後', null, 6, true, true,
  ARRAY['駐車場あり','クレジットカード可','バリアフリー','保険適用'],
  4.1, 53,
  'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&h=500&fit=crop',
  'published'
);

-- 10. 美容皮膚科 GLOW CLINIC 梅田
INSERT INTO facility_profiles (name, slug, business_type, catch_copy, description, postal_code, prefecture, city, address, access_info, phone, business_hours, regular_holiday, seat_count, staff_count, parking, credit_card, features, rating_avg, rating_count, main_photo_url, status)
VALUES (
  '美容皮膚科 GLOW CLINIC 梅田',
  'glow-clinic-umeda',
  '病院・クリニック',
  '梅田駅3分｜美肌・エイジングケアの美容皮膚科',
  '梅田駅から徒歩3分の美容皮膚科クリニック。シミ・しわ・たるみなどの肌悩みに、最新のレーザー機器と医師による丁寧なカウンセリングでアプローチ。ヒアルロン酸注入・ボトックスなどの美容注射も人気。完全予約制で、プライバシーにも配慮した空間です。',
  '5300001', '大阪府', '大阪市北区', '梅田2-4-6 梅田メディカルビル8F',
  'JR大阪駅 桜橋口 徒歩3分',
  '06-7890-1234',
  '{"mon": {"open": "10:00", "close": "19:00"}, "tue": {"open": "10:00", "close": "19:00"}, "wed": null, "thu": {"open": "10:00", "close": "19:00"}, "fri": {"open": "10:00", "close": "19:00"}, "sat": {"open": "10:00", "close": "18:00"}, "sun": null}',
  '水曜・日曜', null, 5, false, true,
  ARRAY['個室あり','クレジットカード可','初回カウンセリング無料'],
  4.6, 31,
  'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&h=500&fit=crop',
  'published'
);

-- =============================================
-- メニューデータ
-- =============================================

-- HAL eyelash salon メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'まつエク', 'シングルラッシュ 100本', 'ナチュラルな仕上がりの定番メニュー', 5500, 60, true, 1 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'まつエク', 'シングルラッシュ 140本', 'しっかり目力アップ', 7700, 80, false, 2 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'まつげパーマ', 'まつげパーマ（上）', '自まつ毛を活かしたナチュラルカール', 4400, 50, true, 3 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'まつげパーマ', 'まつげパーマ（上下セット）', '上下セットでさらに印象的な目元に', 5500, 60, false, 4 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '眉毛', '眉毛デザイン + ワックス', 'お顔の黄金比に合わせた眉毛デザイン', 3300, 30, false, 5 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';

-- hair design BLOOM メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'カット', 'カット + ブロー', '骨格に合わせた似合わせカット', 5500, 60, true, 1 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'カラー', 'フルカラー', 'パーソナルカラー診断付き', 7700, 90, true, 2 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'カラー', 'ハイライトカラー', '立体感のあるデザインカラー', 9900, 120, false, 3 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'パーマ', 'デジタルパーマ', '持ちの良いゆるふわカール', 11000, 120, false, 4 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'トリートメント', 'TOKIOトリートメント', '髪質改善トリートメント', 6600, 40, false, 5 FROM facility_profiles WHERE slug = 'hair-bloom-namba';

-- からだ鍼灸院 メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '鍼灸', '全身鍼灸コース', '肩こり・腰痛・疲労回復に', 6600, 60, true, 1 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '美容鍼', '美容鍼フルコース', 'お顔+デコルテの美容鍼灸', 8800, 70, true, 2 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '鍼灸', '局所治療', '気になる部位を集中ケア', 4400, 30, false, 3 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'よもぎ蒸し', 'よもぎ蒸し + 鍼灸セット', '温活で体の芯から温める', 9900, 90, false, 4 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';

-- すこやか鍼灸整体院 メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '鍼灸', '鍼灸整体コース', '鍼灸+整体で根本改善', 7700, 60, true, 1 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'マッサージ', '全身整体', '全身のバランスを整える', 5500, 50, false, 2 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '鍼灸', 'スポーツ鍼灸', 'スポーツ障害の治療・予防', 6600, 50, true, 3 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'マッサージ', '産後骨盤ケア', '産後の骨盤矯正+ケア', 7700, 60, false, 4 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';

-- さくら整骨院 メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '骨盤矯正', '3Dバランス骨盤矯正', '独自の矯正法で骨盤のゆがみを改善', 5500, 40, true, 1 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '姿勢矯正', '姿勢改善プログラム', '猫背・巻き肩を改善', 6600, 50, true, 2 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '交通事故治療', '交通事故治療', '自賠責保険適用', null, 40, false, 3 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'スポーツ整体', 'スポーツコンディショニング', 'パフォーマンス向上・ケガ予防', 4400, null, 40, false, 4 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';

-- スポーツ整骨院アクティブ メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'スポーツ整体', 'アスリートケアコース', 'プロも通う本格スポーツケア', 8800, 60, true, 1 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '骨盤矯正', '骨盤・姿勢矯正', '体のバランスを整える', 5500, 40, false, 2 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'スポーツ整体', 'パーソナルトレーニング', 'トレーナーによる個別指導', 7700, 50, true, 3 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';

-- デイサービスひまわり メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'デイサービス', '1日型デイサービス', '入浴・食事・機能訓練・レクリエーション', null, '介護保険適用', 540, true, 1 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'リハビリ', '個別機能訓練', '理学療法士による個別リハビリ', null, '介護保険適用', 30, false, 2 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'デイサービス', '半日型デイサービス', '午前or午後の半日利用', null, '介護保険適用', 240, false, 3 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';

-- ケアホームやすらぎ メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'ショートステイ', '短期入所', '1泊2日からご利用可能', null, '介護保険適用', null, true, 1 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, '訪問介護', '訪問介護サービス', 'ご自宅での生活をサポート', null, '介護保険適用', null, false, 2 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, 'リハビリ', '訪問リハビリテーション', '作業療法士が自宅を訪問', null, '介護保険適用', 40, false, 3 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';

-- 内科・皮膚科クリニック メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, '一般外来', '一般内科', '風邪・発熱・生活習慣病', null, '保険適用', null, true, 1 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, '一般外来', '皮膚科', 'アトピー・湿疹・ニキビ', null, '保険適用', null, true, 2 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, '健康診断', '一般健康診断', '基本的な検査項目セット', 8800, null, 60, false, 3 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';
INSERT INTO facility_menus (facility_id, category, name, description, price, price_note, duration_minutes, is_featured, sort_order)
SELECT id, '予防接種', 'インフルエンザワクチン', '毎年10月〜1月受付', 3500, null, 15, false, 4 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';

-- 美容皮膚科 GLOW CLINIC メニュー
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'レーザー', 'シミ取りレーザー', 'ピコレーザーによるシミ治療', 11000, 30, true, 1 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '美容注射', 'ヒアルロン酸注入', 'ほうれい線・涙袋', 33000, 30, true, 2 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, '美容注射', 'ボトックス注射', '額・眉間・目尻のシワ', 22000, 20, false, 3 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'フェイシャル', 'ハイドラフェイシャル', '毛穴洗浄+美容成分導入', 16500, 45, false, 4 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_menus (facility_id, category, name, description, price, duration_minutes, is_featured, sort_order)
SELECT id, 'レーザー', 'フォトフェイシャル', '肌のキメ・ハリ改善', 15400, 30, false, 5 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';

-- =============================================
-- 写真データ（Unsplash）
-- =============================================

-- HAL eyelash salon 写真
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=500&fit=crop', 'main', 'サロン外観', 1 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&h=500&fit=crop', 'interior', '施術スペース', 2 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?w=800&h=500&fit=crop', 'menu', 'まつげエクステ仕上がり', 3 FROM facility_profiles WHERE slug = 'hal-eyelash-sakai';

-- hair design BLOOM 写真
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&h=500&fit=crop', 'main', 'サロン内観', 1 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800&h=500&fit=crop', 'interior', 'カットスペース', 2 FROM facility_profiles WHERE slug = 'hair-bloom-namba';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=800&h=500&fit=crop', 'menu', 'カラーサンプル', 3 FROM facility_profiles WHERE slug = 'hair-bloom-namba';

-- からだ鍼灸院 写真
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=500&fit=crop', 'main', '施術室', 1 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=800&h=500&fit=crop', 'interior', 'リラクゼーションルーム', 2 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=800&h=500&fit=crop', 'menu', '美容鍼施術', 3 FROM facility_profiles WHERE slug = 'karada-shinkyuin-honmachi';

-- 残りの施設写真（各3枚ずつ）
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=800&h=500&fit=crop', 'main', '院内', 1 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=500&fit=crop', 'interior', '施術ベッド', 2 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1540555700478-4be289fbec6f?w=800&h=500&fit=crop', 'staff', 'スタッフ', 3 FROM facility_profiles WHERE slug = 'sukoyaka-tennoji';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&h=500&fit=crop', 'main', '院内', 1 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1666214280557-091e4132752f?w=800&h=500&fit=crop', 'interior', '施術室', 2 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1597764690523-15bea4c581c9?w=800&h=500&fit=crop', 'exterior', '外観', 3 FROM facility_profiles WHERE slug = 'sakura-seikotsuin-umeda';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=500&fit=crop', 'main', 'トレーニングルーム', 1 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=500&fit=crop', 'interior', 'トレーニング設備', 2 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&h=500&fit=crop', 'staff', 'トレーナー', 3 FROM facility_profiles WHERE slug = 'active-seikotsuin-shinsaibashi';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=800&h=500&fit=crop', 'main', '施設外観', 1 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800&h=500&fit=crop', 'interior', '食堂', 2 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1582719471384-894fbb16e074?w=800&h=500&fit=crop', 'other', 'レクリエーション', 3 FROM facility_profiles WHERE slug = 'day-service-himawari-sakai';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1586105251261-72a756497a11?w=800&h=500&fit=crop', 'main', '施設外観', 1 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&h=500&fit=crop', 'interior', '居室', 2 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1551076805-e1869033e561?w=800&h=500&fit=crop', 'other', '共有スペース', 3 FROM facility_profiles WHERE slug = 'care-home-yasuragi-higashiosaka';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&h=500&fit=crop', 'main', 'クリニック外観', 1 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&h=500&fit=crop', 'interior', '待合室', 2 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1581056771107-24ca5f033842?w=800&h=500&fit=crop', 'other', '診察室', 3 FROM facility_profiles WHERE slug = 'naika-hifuka-clinic-sakai';

INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&h=500&fit=crop', 'main', 'クリニック内観', 1 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=800&h=500&fit=crop', 'interior', 'カウンセリングルーム', 2 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
INSERT INTO facility_photos (facility_id, photo_url, photo_type, caption, sort_order)
SELECT id, 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=800&h=500&fit=crop', 'menu', 'フェイシャル施術', 3 FROM facility_profiles WHERE slug = 'glow-clinic-umeda';
