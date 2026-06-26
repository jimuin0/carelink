import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = (searchParams.get('title') || 'CareLink').slice(0, 40);
  const subtitle = (searchParams.get('subtitle') || 'ネットでかんたんサロン予約').slice(0, 60);
  const ratingStr = searchParams.get('rating');
  const reviewCount = searchParams.get('reviews') || '';
  const isFacility = !!ratingStr;

  // rating は 0〜5 にクランプし NaN/Infinity を弾く（?rating=Infinity や巨大値で "Infinity"・309桁の数字が
  // OG 画像に描画されレイアウト崩れ・詐欺的表示になるのを防ぐ）。
  const ratingParsed = ratingStr ? parseFloat(ratingStr) : null;
  const rating = ratingParsed !== null && Number.isFinite(ratingParsed)
    ? Math.min(5, Math.max(0, ratingParsed))
    : null;
  const ratingDisplay = rating !== null ? rating.toFixed(1) : null;

  // 星の個数（満点5）
  const fullStars = rating !== null ? Math.floor(rating) : 0;
  const hasHalf = rating !== null ? (rating - fullStars) >= 0.5 : false;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#f0f9ff',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* 左側カラーバー */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 12,
          height: '100%',
          background: 'linear-gradient(180deg, #0284c7 0%, #38bdf8 100%)',
          display: 'flex',
        }} />

        {/* メインコンテンツ */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          paddingLeft: 72,
          paddingRight: 60,
          paddingTop: 60,
          paddingBottom: 60,
        }}>
          {/* ヘッダー */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)',
              color: '#fff',
              fontSize: 24,
              fontWeight: 700,
              padding: '6px 20px',
              borderRadius: 999,
              display: 'flex',
            }}>
              CareLink
            </div>
            {isFacility && (
              <div style={{
                background: '#e0f2fe',
                color: '#0284c7',
                fontSize: 20,
                padding: '4px 16px',
                borderRadius: 999,
                display: 'flex',
              }}>
                施設情報
              </div>
            )}
          </div>

          {/* 施設名 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              fontSize: title.length > 20 ? 56 : 68,
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              display: 'flex',
            }}>
              {title}
            </div>
            <div style={{
              fontSize: 28,
              color: '#475569',
              display: 'flex',
            }}>
              {subtitle}
            </div>

            {/* 評価 */}
            {ratingDisplay && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <div style={{
                  fontSize: 48,
                  fontWeight: 700,
                  color: '#f59e0b',
                  display: 'flex',
                }}>
                  {ratingDisplay}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} style={{
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 28,
                      color: i <= fullStars ? '#f59e0b' : (i === fullStars + 1 && hasHalf ? '#f59e0b' : '#d1d5db'),
                    }}>
                      ★
                    </div>
                  ))}
                </div>
                {reviewCount && (
                  <div style={{ fontSize: 22, color: '#64748b', display: 'flex' }}>
                    ({reviewCount}件)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* フッター */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <div style={{
              fontSize: 18,
              color: '#94a3b8',
              display: 'flex',
            }}>
              carelink-jp.com
            </div>
          </div>
        </div>

        {/* 右側デコレーション */}
        <div style={{
          position: 'absolute',
          right: -100,
          top: -100,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'rgba(14,165,233,0.08)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute',
          right: 60,
          bottom: -60,
          width: 250,
          height: 250,
          borderRadius: '50%',
          background: 'rgba(14,165,233,0.06)',
          display: 'flex',
        }} />
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
