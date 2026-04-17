'use client';

import { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

export default function AdminQrCodePage() {
  const [facilitySlug, setFacilitySlug] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: member } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      if (!member) { setLoading(false); return; }
      const { data: facility } = await supabase
        .from('facility_profiles')
        .select('slug, name')
        .eq('id', member.facility_id)
        .single();
      if (!facility) { setLoading(false); return; }
      setFacilitySlug(facility.slug);
      setFacilityName(facility.name);

      const url = `https://carelink-jp.com/facility/${facility.slug}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: '#0c4a6e', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setLoading(false);
    };
    init().catch(() => setLoading(false));
  }, []);

  const handleDownload = () => {
    if (!qrDataUrl || !facilitySlug) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `carelink-qr-${facilitySlug}.png`;
    a.click();
    setToast({ type: 'success', message: 'QRコードをダウンロードしました' });
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (!facilitySlug) {
    return <p className="text-gray-500">施設情報が見つかりませんでした。</p>;
  }

  const facilityUrl = `https://carelink-jp.com/facility/${facilitySlug}`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">QRコード</h1>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* QRコードプレビュー */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-bold mb-4">施設ページQRコード</h2>
          {qrDataUrl && (
            <div className="flex flex-col items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QRコード" className="w-48 h-48" />
              <p className="text-xs text-gray-500 text-center break-all">{facilityUrl}</p>
              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex-1 px-4 py-2 bg-sky-500 text-white text-sm font-bold rounded-lg hover:bg-sky-600 transition-colors"
                >
                  PNG保存
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-50 transition-colors print:hidden"
                >
                  印刷
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ポスター印刷プレビュー */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-bold mb-4">ポスター印刷用プレビュー</h2>
          <div
            id="qr-poster"
            className="border-2 border-sky-200 rounded-xl p-6 flex flex-col items-center gap-3 bg-gradient-to-b from-sky-50 to-white"
          >
            <p className="text-xs text-sky-500 font-bold tracking-widest uppercase">CareLink</p>
            <p className="text-lg font-bold text-center text-gray-800">{facilityName}</p>
            <p className="text-sm text-gray-500 text-center">オンライン予約はこちら</p>
            {qrDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qrDataUrl} alt="QRコード" className="w-36 h-36" />
            )}
            <p className="text-xs text-gray-400 text-center break-all">{facilityUrl}</p>
          </div>
          <p className="text-xs text-gray-400 mt-3">「印刷」ボタンからA4・ハガキサイズで印刷できます。</p>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
