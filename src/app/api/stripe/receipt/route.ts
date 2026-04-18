/**
 * 領収書生成
 * GET /api/stripe/receipt?session_id=xxx
 * — HTML → ブラウザで印刷可能な領収書
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function GET(request: NextRequest) {
  try {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId || sessionId.length > 200) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const admin = createServiceRoleClient();

  const { data: session } = await admin
    .from('stripe_sessions')
    .select('*, facility_profiles(name, address, phone, postal_code, prefecture, city)')
    .eq('stripe_session_id', sessionId)
    .eq('user_id', user.id)
    .single();

  if (!session) return NextResponse.json({ error: '領収書が見つかりません' }, { status: 404 });
  if (session.status !== 'paid') return NextResponse.json({ error: '未払いの予約には領収書を発行できません' }, { status: 400 });

  const facility = Array.isArray(session.facility_profiles) ? session.facility_profiles[0] : session.facility_profiles;
  const issuedDate = new Date(session.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const receiptNo = `CL-${session.id.slice(0, 8).toUpperCase()}`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>領収書 ${receiptNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Hiragino Kaku Gothic Pro', 'Meiryo', sans-serif; color: #1a1a1a; background: white; padding: 40px; max-width: 600px; margin: 0 auto; }
    h1 { font-size: 28px; text-align: center; font-weight: 900; letter-spacing: 0.1em; margin-bottom: 8px; }
    .subtitle { text-align: center; font-size: 12px; color: #555; margin-bottom: 32px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 13px; }
    .section { margin-bottom: 24px; }
    .label { font-size: 11px; color: #888; margin-bottom: 4px; }
    .value { font-size: 15px; font-weight: 600; }
    .amount-box { border: 2px solid #1a1a1a; padding: 20px; margin: 24px 0; text-align: center; }
    .amount-label { font-size: 12px; color: #555; margin-bottom: 4px; }
    .amount { font-size: 36px; font-weight: 900; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; }
    th { text-align: left; background: #f5f5f5; padding: 8px 12px; border: 1px solid #ddd; }
    td { padding: 8px 12px; border: 1px solid #ddd; }
    td:last-child { text-align: right; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #888; text-align: center; }
    .stamp { float: right; width: 80px; height: 80px; border: 2px solid #e53e3e; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #e53e3e; font-size: 14px; font-weight: 900; letter-spacing: 0.1em; transform: rotate(-15deg); margin-top: -20px; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
      @page { margin: 1cm; }
    }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="margin-bottom:24px;padding:8px 20px;background:#0284C7;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;display:block;margin-left:auto;">
    印刷・PDF保存
  </button>

  <h1>領　収　書</h1>
  <p class="subtitle">RECEIPT</p>

  <div class="meta">
    <span>No. ${receiptNo}</span>
    <span>発行日: ${issuedDate}</span>
  </div>

  <div class="section">
    <div class="label">お名前</div>
    <div class="value" style="font-size:18px;">　　　　　　　　　　様</div>
  </div>

  <div class="amount-box">
    <div class="amount-label">金額（税込）</div>
    <div class="amount">¥${session.amount.toLocaleString()}<sup style="font-size:18px;">円也</sup></div>
  </div>

  <table>
    <thead>
      <tr><th>摘要</th><th>種別</th><th>金額</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(facility?.name ?? '施設')} ${session.payment_type === 'deposit' ? 'デポジット（予約保証金）' : '施術料金'}</td>
        <td>課税</td>
        <td>¥${session.amount.toLocaleString()}</td>
      </tr>
      <tr>
        <td colspan="1">うち消費税（10%）</td>
        <td></td>
        <td>¥${Math.round(session.amount * 10 / 110).toLocaleString()}</td>
      </tr>
    </tbody>
  </table>

  <div class="stamp">領収<br/>済</div>

  <div class="section" style="clear:both;margin-top:32px;">
    <div class="label">発行者</div>
    <div class="value">${esc(facility?.name ?? '施設名')}</div>
    ${facility?.postal_code ? `<div style="font-size:13px;color:#555;margin-top:4px;">〒${esc(facility.postal_code)} ${esc(facility?.prefecture ?? '')}${esc(facility?.city ?? '')}${esc(facility?.address ?? '')}</div>` : ''}
    ${facility?.phone ? `<div style="font-size:13px;color:#555;">TEL: ${esc(facility.phone)}</div>` : ''}
  </div>

  <div class="footer">
    <p>CareLink（ケアリンク）https://carelink-jp.com</p>
    <p>この領収書は電子的に発行されました</p>
    <p style="margin-top:4px;font-size:10px;">決済ID: ${esc(session.stripe_session_id)}</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
  } catch (e) {
    console.error('[stripe/receipt] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
