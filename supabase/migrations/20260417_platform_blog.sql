-- プラットフォームブログ CMS（v8.41）
-- CareLink 公式コラム記事をDBで管理（静的ファイルから移行）

CREATE TABLE IF NOT EXISTS platform_blog_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  reading_time  INTEGER NOT NULL DEFAULT 5,
  content       JSONB NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMPTZ,
  author_name   TEXT NOT NULL DEFAULT 'CareLink編集部',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_blog_published ON platform_blog_posts (published_at DESC) WHERE is_published = true;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_platform_blog_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_platform_blog_updated_at
  BEFORE UPDATE ON platform_blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_platform_blog_updated_at();

-- RLS: 公開記事は誰でも読める、書き込みは管理者のみ
ALTER TABLE platform_blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_blog_public_read" ON platform_blog_posts
  FOR SELECT USING (is_published = true);
CREATE POLICY "platform_blog_admin_all" ON platform_blog_posts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- 既存の静的記事をシード
INSERT INTO platform_blog_posts (slug, title, description, category, tags, reading_time, is_published, published_at, content) VALUES
(
  'first-eyelash-perm-guide',
  '初めてのまつ毛パーマ完全ガイド｜持ち・料金・注意点まとめ',
  'まつ毛パーマが初めての方に向けて、施術の流れ・料金相場・持ち期間・注意点をわかりやすく解説します。',
  '美容ガイド',
  ARRAY['まつ毛パーマ', 'まつげ', '初めて'],
  8, true, '2026-03-20',
  '[
    {"type":"paragraph","text":"まつ毛パーマは、ビューラーなしで自然なカールが手に入る人気の施術。毎朝のメイク時間を短縮できることから、多くの女性に支持されています。"},
    {"type":"heading","heading":"まつ毛パーマとは？"},
    {"type":"paragraph","text":"まつ毛パーマとは、専用の薬剤とロッドを使ってまつ毛にカールをつける施術です。ビューラーで毎回カールさせる必要がなくなり、約1〜2ヶ月間カールが続きます。"},
    {"type":"heading","heading":"料金相場"},
    {"type":"paragraph","text":"まつ毛パーマの料金相場は、3,000〜8,000円程度です。サロンの立地・技術レベル・使用薬剤によって大きく異なります。"},
    {"type":"heading","heading":"持ち期間と注意点"},
    {"type":"list","items":["施術後48時間は水濡れを避ける","まつ毛美容液でケアすると持ちが良くなる","アレルギーがある方は事前にパッチテストを"]},
    {"type":"callout","calloutType":"tip","text":"初めてのサロン選びは、口コミと施術実績を確認しましょう。CareLink では写真付きのリアルな口コミが揃っています。"}
  ]'::jsonb
),
(
  'acupuncture-beginner-guide',
  '鍼灸が初めての方へ｜効果・施術の流れ・選び方を徹底解説',
  '鍼灸治療が初めての方に向けて、期待できる効果・施術の流れ・良い院の選び方をわかりやすくまとめました。',
  '健康ガイド',
  ARRAY['鍼灸', '鍼灸院', '初めて', '効果'],
  10, true, '2026-03-18',
  '[
    {"type":"paragraph","text":"「鍼って痛くないの？」「どんな症状に効くの？」初めての方が抱く疑問を、この記事でまとめて解消します。"},
    {"type":"heading","heading":"鍼灸で期待できる効果"},
    {"type":"list","items":["肩こり・腰痛の緩和","頭痛・偏頭痛の改善","自律神経の調整","冷え性・むくみの改善","不眠・ストレスの軽減"]},
    {"type":"heading","heading":"施術の流れ"},
    {"type":"paragraph","text":"① 問診（症状・生活習慣のヒアリング）→ ② 検査（脈診・腹診）→ ③ 施術（鍼・灸）→ ④ アフターケアの説明。初回は60〜90分が目安です。"},
    {"type":"heading","heading":"良い鍼灸院の選び方"},
    {"type":"list","items":["国家資格（鍼師・灸師）保有者が施術","丁寧な問診がある","衛生管理が徹底されている","口コミ評価が高い"]},
    {"type":"callout","calloutType":"info","text":"CareLink では国家資格保有スタッフが在籍する鍼灸院を多数掲載。エリア・症状で絞り込んで探せます。"}
  ]'::jsonb
),
(
  'nail-salon-care-tips',
  'ネイルサロン歴10年が教える！持ちを2週間延ばすケア術',
  'ジェルネイルをきれいに長持ちさせるための日常ケア・NGな行動・おすすめアイテムをプロが解説。',
  '美容ガイド',
  ARRAY['ネイル', 'ジェルネイル', 'ケア', '長持ち'],
  7, true, '2026-03-15',
  '[
    {"type":"paragraph","text":"ジェルネイルは正しいケアをするだけで、持ちが大幅に変わります。今回はネイリスト歴10年のプロが、毎日できる簡単ケア術を紹介します。"},
    {"type":"heading","heading":"NG行動 TOP3"},
    {"type":"list","items":["爪先で缶を開ける・シールをはがす","水仕事後に保湿しない","オフ後すぐに再施術する"]},
    {"type":"heading","heading":"おすすめの毎日ケア"},
    {"type":"list","items":["就寝前のキューティクルオイル（爪の根元に1滴）","水仕事時のゴム手袋着用","2〜3日に1回のハンドクリーム"]},
    {"type":"callout","calloutType":"tip","text":"丁寧なアフターケアを教えてくれるネイルサロンを選ぶのも大切。CareLink でスタッフのこだわりをチェックしてみてください。"}
  ]'::jsonb
),
(
  'osteopathy-vs-chiropractor',
  '整骨院と整体院の違いとは？保険適用・効果・選び方まとめ',
  '似ているようで違う整骨院と整体院。保険の使い方・得意な症状・選び方のポイントを比較解説します。',
  '健康ガイド',
  ARRAY['整骨院', '整体院', '保険適用', '腰痛', '肩こり'],
  9, true, '2026-03-12',
  '[
    {"type":"paragraph","text":"「整骨院と整体院、何が違うの？」よく聞かれるこの質問。実は資格・保険の使い方・得意な症状が大きく異なります。"},
    {"type":"heading","heading":"整骨院（接骨院）とは"},
    {"type":"paragraph","text":"国家資格「柔道整復師」が施術。急性の外傷（捻挫・骨折・脱臼・打撲・肉離れ）は健康保険が使えます。慢性的な肩こり・腰痛には保険適用外となります。"},
    {"type":"heading","heading":"整体院とは"},
    {"type":"paragraph","text":"法的な資格規定がなく、民間資格や独自技術での施術が中心。慢性的な不調・姿勢改善・リラクゼーションを得意とします。保険適用はありません。"},
    {"type":"heading","heading":"こんな症状はどちらへ？"},
    {"type":"list","items":["捻挫・打撲・肉離れ → 整骨院（保険OK）","慢性腰痛・肩こり → 整体院 or 鍼灸院","原因不明の不調 → まず医療機関を受診"]},
    {"type":"callout","calloutType":"warning","text":"保険適用については施術内容によって異なります。来院前に確認することをおすすめします。"}
  ]'::jsonb
),
(
  'esthetic-salon-guide',
  'エステサロン初体験！種類・効果・予算の全知識',
  'フェイシャル・痩身・脱毛など種類が多いエステサロン。目的別の選び方と初回体験の注意点を解説。',
  '美容ガイド',
  ARRAY['エステ', 'エステサロン', 'フェイシャル', '痩身', '脱毛'],
  8, true, '2026-03-10',
  '[
    {"type":"paragraph","text":"エステサロンには様々な種類があり、初めての方は何を選べばいいか迷いがち。この記事では、目的別にどのエステを選ぶべきかを分かりやすく解説します。"},
    {"type":"heading","heading":"エステの主な種類"},
    {"type":"list","items":["フェイシャルエステ：毛穴・くすみ・シミのケア","ボディエステ（痩身）：セルライト・ボディラインの改善","脱毛：産毛・ムダ毛の除去","リフトアップ：たるみ・ほうれい線の改善"]},
    {"type":"heading","heading":"初回体験を賢く使う"},
    {"type":"list","items":["目的を明確にしてから予約する","施術内容・料金・継続の必要性を事前確認","断りやすい雰囲気か確認する（強引な勧誘に注意）"]},
    {"type":"callout","calloutType":"tip","text":"CareLink では口コミや施術メニューが詳細に確認できます。初回体験前にチェックしておきましょう。"}
  ]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
