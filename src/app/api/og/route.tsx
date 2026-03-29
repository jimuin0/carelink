import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = (searchParams.get('title') || 'CareLink').slice(0, 60);
  const subtitle = (searchParams.get('subtitle') || 'ネットでかんたんサロン予約').slice(0, 60);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 50%, #38bdf8 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 60px',
            maxWidth: '90%',
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: '#ffffff',
              textAlign: 'center',
              lineHeight: 1.3,
              letterSpacing: '-0.02em',
              display: 'flex',
            }}
          >
            {title.length > 30 ? title.slice(0, 30) + '...' : title}
          </div>
          <div
            style={{
              fontSize: 24,
              color: 'rgba(255,255,255,0.8)',
              marginTop: 16,
              display: 'flex',
            }}
          >
            {subtitle}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '0.05em',
              display: 'flex',
            }}
          >
            CareLink
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
