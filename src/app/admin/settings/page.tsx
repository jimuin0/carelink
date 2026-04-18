'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { businessTypes, facilityFeatures, prefectures, dayOrder, dayLabels } from '@/lib/constants';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import dynamic from 'next/dynamic';

const NotificationSettings = dynamic(() => import('@/components/admin/NotificationSettings'), { ssr: false });
const CancelPolicySettings = dynamic(() => import('@/components/admin/CancelPolicySettings'), { ssr: false });

interface BusinessHours {
  [key: string]: { open: string; close: string } | null;
}

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Basic info
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [catchCopy, setCatchCopy] = useState('');
  const [description, setDescription] = useState('');

  // Location
  const [postalCode, setPostalCode] = useState('');
  const [prefecture, setPrefecture] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [building, setBuilding] = useState('');
  const [accessInfo, setAccessInfo] = useState('');

  // Contact
  const [phone, setPhone] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');

  // Details
  const [seatCount, setSeatCount] = useState('');
  const [staffCount, setStaffCount] = useState('');
  const [parking, setParking] = useState(false);
  const [creditCard, setCreditCard] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [regularHoliday, setRegularHoliday] = useState('');
  const [facilityStatus, setFacilityStatus] = useState<'draft' | 'published' | 'suspended'>('draft');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [publishToggling, setPublishToggling] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  // Business hours
  const [hours, setHours] = useState<BusinessHours>(() => {
    const init: BusinessHours = {};
    dayOrder.forEach((d) => { init[d] = { open: '09:00', close: '19:00' }; });
    return init;
  });
  const [closedDays, setClosedDays] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);

      const { data } = await supabase.from('facility_profiles').select('*').eq('id', membership.facility_id).single();
      if (data) {
        setName(data.name || '');
        setBusinessType(data.business_type || '');
        setCatchCopy(data.catch_copy || '');
        setDescription(data.description || '');
        setPostalCode(data.postal_code || '');
        setPrefecture(data.prefecture || '');
        setCity(data.city || '');
        setAddress(data.address || '');
        setBuilding(data.building || '');
        setAccessInfo(data.access_info || '');
        setPhone(data.phone || '');
        setWebsiteUrl(data.website_url || '');
        setSeatCount(data.seat_count?.toString() || '');
        setStaffCount(data.staff_count?.toString() || '');
        setParking(data.parking ?? false);
        setCreditCard(data.credit_card ?? false);
        setSelectedFeatures(data.features || []);
        setRegularHoliday(data.regular_holiday || '');
        setFacilityStatus(data.status || 'draft');
        setAutoConfirm(data.booking_auto_confirm ?? false);
        setBufferMinutes(data.booking_buffer_minutes ?? 0);
        if (data.business_hours) {
          const bh = data.business_hours as BusinessHours;
          const closed: string[] = [];
          dayOrder.forEach((d) => {
            if (!bh[d]) closed.push(d);
          });
          setHours(prev => ({ ...prev, ...bh }));
          setClosedDays(closed);
        }
      }
      setLoading(false);
    };
    load().catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFeature = (f: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
  };

  const toggleClosed = (day: string) => {
    setClosedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const updateHour = (day: string, field: 'open' | 'close', value: string) => {
    setHours((prev) => ({
      ...prev,
      [day]: { ...(prev[day] || { open: '09:00', close: '19:00' }), [field]: value },
    }));
  };

  const handleSave = async () => {
    if (saving || !facilityId || !name) return;

    // 営業時間の整合性チェック
    for (const d of dayOrder) {
      if (closedDays.includes(d)) continue;
      const h = hours[d] || { open: '09:00', close: '19:00' };
      if (h.close <= h.open) {
        setToast({ type: 'error', message: `${dayLabels[d]}の閉店時間は開店時間より後にしてください` });
        return;
      }
    }

    setSaving(true);
    try {
      const businessHours: BusinessHours = {};
      dayOrder.forEach((d) => {
        businessHours[d] = closedDays.includes(d) ? null : (hours[d] || { open: '09:00', close: '19:00' });
      });

      const res = await fetch(`/api/admin/settings?facility_id=${facilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          business_type: businessType,
          catch_copy: catchCopy || null,
          description: description || null,
          postal_code: postalCode || null,
          prefecture,
          city,
          address,
          building: building || null,
          access_info: accessInfo || null,
          phone: phone || null,
          website_url: websiteUrl || null,
          seat_count: seatCount ? parseInt(seatCount) : null,
          staff_count: staffCount ? parseInt(staffCount) : null,
          parking,
          credit_card: creditCard,
          features: selectedFeatures,
          regular_holiday: regularHoliday || null,
          business_hours: businessHours,
          booking_auto_confirm: autoConfirm,
          booking_buffer_minutes: bufferMinutes,
        }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '保存に失敗しました' });
      } else {
        setToast({ type: 'success', message: '施設情報を保存しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="bg-white rounded-xl p-6 space-y-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-200 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">施設設定</h1>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${facilityStatus === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {facilityStatus === 'published' ? '公開中' : '非公開'}
            </span>
            <button
              type="button"
              onClick={async () => {
                const newStatus = facilityStatus === 'published' ? 'draft' : 'published';
                if (newStatus === 'draft') { setShowUnpublishConfirm(true); return; }
                setPublishToggling(true);
                const res = await fetch(`/api/admin/settings?facility_id=${facilityId}&action=status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: newStatus }),
                });
                if (res.ok) {
                  setFacilityStatus(newStatus);
                  setToast({ type: 'success', message: '施設を公開しました！' });
                } else {
                  setToast({ type: 'error', message: '公開に失敗しました' });
                }
                setPublishToggling(false);
              }}
              disabled={publishToggling || !facilityId}
              className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${facilityStatus === 'published' ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-500 text-white hover:bg-green-600'}`}
            >
              {publishToggling ? '処理中...' : facilityStatus === 'published' ? '非公開にする' : '公開する'}
            </button>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-6 !py-2.5">
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>

      {/* 基本情報 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">基本情報</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="fac-name" className="form-label">施設名 <span className="text-red-500">*</span></label>
            <input id="fac-name" value={name} onChange={(e) => setName(e.target.value)} className="form-input" maxLength={100} />
          </div>
          <div>
            <label htmlFor="fac-type" className="form-label">業種 <span className="text-red-500">*</span></label>
            <select id="fac-type" value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="form-input">
              <option value="">選択してください</option>
              {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fac-catch" className="form-label">キャッチコピー</label>
            <input id="fac-catch" value={catchCopy} onChange={(e) => setCatchCopy(e.target.value)} className="form-input" maxLength={200} placeholder="例: 駅チカ3分！技術力No.1" />
          </div>
          <div>
            <label htmlFor="fac-desc" className="form-label">施設紹介</label>
            <textarea id="fac-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={5} maxLength={2000} />
          </div>
        </div>
      </section>

      {/* 所在地 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">所在地</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fac-zip" className="form-label">郵便番号</label>
              <input id="fac-zip" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="form-input" placeholder="123-4567" maxLength={8} />
            </div>
            <div>
              <label htmlFor="fac-pref" className="form-label">都道府県 <span className="text-red-500">*</span></label>
              <select id="fac-pref" value={prefecture} onChange={(e) => setPrefecture(e.target.value)} className="form-input">
                <option value="">選択</option>
                {prefectures.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fac-city" className="form-label">市区町村 <span className="text-red-500">*</span></label>
              <input id="fac-city" value={city} onChange={(e) => setCity(e.target.value)} className="form-input" maxLength={50} />
            </div>
            <div>
              <label htmlFor="fac-addr" className="form-label">番地 <span className="text-red-500">*</span></label>
              <input id="fac-addr" value={address} onChange={(e) => setAddress(e.target.value)} className="form-input" maxLength={100} />
            </div>
          </div>
          <div>
            <label htmlFor="fac-bldg" className="form-label">建物名・階</label>
            <input id="fac-bldg" value={building} onChange={(e) => setBuilding(e.target.value)} className="form-input" maxLength={100} />
          </div>
          <div>
            <label htmlFor="fac-access" className="form-label">アクセス情報</label>
            <input id="fac-access" value={accessInfo} onChange={(e) => setAccessInfo(e.target.value)} className="form-input" placeholder="例: 渋谷駅から徒歩3分" maxLength={200} />
          </div>
        </div>
      </section>

      {/* 連絡先 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">連絡先</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="fac-phone" className="form-label">電話番号</label>
            <input id="fac-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="form-input" placeholder="03-1234-5678" maxLength={20} />
          </div>
          <div>
            <label htmlFor="fac-web" className="form-label">Webサイト</label>
            <input id="fac-web" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className="form-input" placeholder="https://" maxLength={200} />
          </div>
        </div>
      </section>

      {/* 営業時間 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">営業時間</h2>
        <div className="space-y-3">
          {dayOrder.map((day) => (
            <div key={day} className="flex items-center gap-3">
              <label className="w-8 text-sm font-medium text-center">{dayLabels[day]}</label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!closedDays.includes(day)}
                  onChange={() => toggleClosed(day)}
                  className="rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                />
                <span className="text-xs text-gray-500">営業</span>
              </label>
              {!closedDays.includes(day) ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={hours[day]?.open || '09:00'}
                    onChange={(e) => updateHour(day, 'open', e.target.value)}
                    className="form-input !py-1.5 !px-2 text-sm w-32"
                  />
                  <span className="text-gray-400">〜</span>
                  <input
                    type="time"
                    value={hours[day]?.close || '19:00'}
                    onChange={(e) => updateHour(day, 'close', e.target.value)}
                    className="form-input !py-1.5 !px-2 text-sm w-32"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400">定休日</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <label htmlFor="fac-holiday" className="form-label">定休日（補足）</label>
          <input id="fac-holiday" value={regularHoliday} onChange={(e) => setRegularHoliday(e.target.value)} className="form-input" placeholder="例: 第2・4月曜、年末年始" maxLength={100} />
        </div>
      </section>

      {/* 予約設定 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">予約設定</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoConfirm}
            onChange={(e) => setAutoConfirm(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">予約を即時確定する</p>
            <p className="text-xs text-gray-500 mt-0.5">
              ONにすると、ユーザーが予約した際に自動で「確定」状態になります。OFFの場合は「承認待ち」として管理画面で手動確定が必要です。
            </p>
          </div>
        </label>
        <div className="mt-4 border-t pt-4">
          <label htmlFor="buffer-minutes" className="block text-sm font-medium text-gray-800 mb-1">
            施術後バッファタイム（準備時間）
          </label>
          <p className="text-xs text-gray-500 mb-2">
            施術終了後に確保するスタッフの準備時間です。この時間は予約枠として表示されません。
          </p>
          <div className="flex items-center gap-3">
            <select
              id="buffer-minutes"
              value={bufferMinutes}
              onChange={(e) => setBufferMinutes(parseInt(e.target.value))}
              className="form-input w-40"
            >
              {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>{m === 0 ? 'なし' : `${m}分`}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 設備・特徴 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">設備・特徴</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="fac-seats" className="form-label">席数</label>
            <input id="fac-seats" type="number" min={0} value={seatCount} onChange={(e) => setSeatCount(e.target.value)} className="form-input" />
          </div>
          <div>
            <label htmlFor="fac-staff-count" className="form-label">スタッフ数</label>
            <input id="fac-staff-count" type="number" min={0} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} className="form-input" />
          </div>
        </div>
        <div className="flex items-center gap-6 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={parking} onChange={(e) => setParking(e.target.checked)} className="rounded border-gray-300 text-sky-500 focus:ring-sky-500" />
            <span className="text-sm">駐車場あり</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={creditCard} onChange={(e) => setCreditCard(e.target.checked)} className="rounded border-gray-300 text-sky-500 focus:ring-sky-500" />
            <span className="text-sm">クレジットカード可</span>
          </label>
        </div>
        <p className="form-label">その他の特徴</p>
        <div className="flex flex-wrap gap-2">
          {facilityFeatures.filter((f) => f !== '駐車場あり' && f !== 'クレジットカード可').map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => toggleFeature(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                selectedFeatures.includes(f)
                  ? 'bg-sky-500 text-white border-sky-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      {/* データエクスポート */}
      <section className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">データエクスポート</h2>
        <p className="text-sm text-gray-500 mb-4">予約データをCSV形式でダウンロードできます。</p>
        <button
          type="button"
          onClick={async () => {
            if (!facilityId) return;
            const supabase = createBrowserSupabaseClient();
            const { data } = await supabase
              .from('bookings')
              .select('id, booking_date, start_time, end_time, customer_name, email, phone, status, total_price, note, created_at')
              .eq('facility_id', facilityId)
              .order('booking_date', { ascending: false })
              .limit(5000);
            if (!data || data.length === 0) {
              setToast({ type: 'error', message: 'エクスポートする予約データがありません' });
              return;
            }
            const csvSafe = (v: string | number | null | undefined): string => {
              const s = String(v ?? '');
              const escaped = s.replace(/"/g, '""');
              const needsPrefix = /^[=+\-@\t\r]/.test(s);
              return `"${needsPrefix ? "'" : ''}${escaped}"`;
            };
            const headers = ['予約ID', '予約日', '開始時間', '終了時間', '顧客名', 'メール', '電話', 'ステータス', '金額', '備考', '作成日'];
            const csvRows = [
              headers.map((h) => `"${h}"`).join(','),
              ...data.map((r) =>
                [r.id, r.booking_date, r.start_time, r.end_time, r.customer_name, r.email, r.phone, r.status, r.total_price, r.note, r.created_at].map(csvSafe).join(',')
              ),
            ];
            const bom = '\uFEFF';
            const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `carelink-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 200);
            setToast({ type: 'success', message: data.length >= 5000 ? 'CSVをダウンロードしました（5000件で切り捨て）' : 'CSVをダウンロードしました' });
          }}
          className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          予約データCSVダウンロード
        </button>
      </section>

      {/* 保存ボタン(下部) */}
      <div className="flex justify-end">
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-8 !py-3">
          {saving ? '保存中...' : '施設情報を保存'}
        </button>
      </div>

      {/* キャンセルポリシー（v8.5） */}
      {facilityId && <CancelPolicySettings facilityId={facilityId} />}

      {/* 通知設定（v8.1） */}
      {facilityId && <NotificationSettings facilityId={facilityId} />}

      {/* GBP連携（Googleビジネスプロフィール） */}
      <section className="bg-white rounded-xl shadow-sm p-6 mt-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">GBP連携（Googleビジネスプロフィール）</h2>
          <a href="/admin/gbp" className="text-sm text-sky-500 underline">GBP管理画面へ →</a>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Google Place ID を登録すると、Googleマップの診断スコア・クチコミ・投稿管理が使えます。
        </p>
        <div className="bg-sky-50 rounded-lg p-3 text-xs text-sky-700 mb-4">
          Place ID は{' '}
          <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
             target="_blank" rel="noopener noreferrer" className="underline">Place ID Finder</a>
          {' '}で自店舗を検索して取得できます（「ChIJ...」から始まる文字列）
        </div>
        <a href="/admin/gbp" className="inline-block bg-sky-500 text-white text-sm px-5 py-2 rounded-lg hover:bg-sky-600 transition-colors">
          GBP設定・診断を開く
        </a>
      </section>

      {/* LINE Works連携 */}
      <section className="bg-white rounded-xl shadow-sm p-6 mt-6">
        <h2 className="text-lg font-bold mb-1">LINE Works連携</h2>
        <p className="text-sm text-gray-500 mb-4">
          新規予約・キャンセルをLINE Worksのスタッフグループに通知できます。
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <strong>設定方法</strong>
          <ol className="list-decimal pl-4 mt-2 space-y-2">
            <li>LINE Works管理コンソールでBotを作成し、各スタッフのDM or グループチャンネルに招待</li>
            <li>以下の環境変数をVercelに設定:
              <code className="block bg-white/50 px-2 py-1 rounded mt-1 text-xs font-mono">
                LINE_WORKS_CLIENT_ID, LINE_WORKS_CLIENT_SECRET,<br />
                LINE_WORKS_SERVICE_ACCOUNT, LINE_WORKS_PRIVATE_KEY, LINE_WORKS_BOT_ID
              </code>
            </li>
            <li>
              各スタッフの編集画面（スタッフ管理 → 編集）で
              <strong>「LINE Works チャンネルID」</strong>を設定
              <br />
              <span className="text-xs text-amber-700">チャンネルIDはLINE Works Bot設定のChannel IDで確認できます</span>
            </li>
            <li>設定後、新規予約・キャンセル・予約変更時に自動通知が送信されます</li>
          </ol>
        </div>
      </section>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={showUnpublishConfirm}
        title="施設を非公開にする"
        message="施設を非公開にしますか？検索結果から消え、新規予約ができなくなります。"
        confirmLabel="非公開にする"
        cancelLabel="キャンセル"
        onConfirm={async () => {
          setShowUnpublishConfirm(false);
          setPublishToggling(true);
          const res = await fetch(`/api/admin/settings?facility_id=${facilityId}&action=status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'draft' }),
          });
          if (res.ok) {
            setFacilityStatus('draft');
            setToast({ type: 'success', message: '施設を非公開にしました' });
          } else {
            setToast({ type: 'error', message: '非公開への変更に失敗しました' });
          }
          setPublishToggling(false);
        }}
        onCancel={() => setShowUnpublishConfirm(false)}
      />
    </div>
  );
}
