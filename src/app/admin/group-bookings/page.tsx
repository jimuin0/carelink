'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

interface GroupBooking {
  id: string;
  share_code: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  total_members: number;
  confirmed_members: number;
  status: string;
  notes: string | null;
  created_at: string;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  completed: { label: '完了', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
};

export default function AdminGroupBookingsPage() {
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<GroupBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return; }
      const { data: mem } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!mem) { setLoading(false); return; }
      setFacilityId(mem.facility_id);

      const { data } = await supabase
        .from('group_bookings')
        .select('*')
        .eq('facility_id', mem.facility_id)
        .order('booking_date', { ascending: false })
        .limit(50);

      setBookings((data ?? []) as GroupBooking[]);
      setLoading(false);
    });
  }, []);

  const copyShareUrl = (code: string) => {
    const url = `${window.location.origin}/group-booking/join/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleStatusChange = async (id: string, status: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/group-booking/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setBookings((prev) => prev.map((b) => b.id === id ? { ...b, status } : b));
      } else {
        const data = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: data.error || 'ステータスの更新に失敗しました' });
      }
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-40 bg-gray-200 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <div>
        <h1 className="text-xl font-bold">グループ予約</h1>
        <p className="text-xs text-gray-400 mt-0.5">複数人同時予約の管理・シェアリンク発行</p>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-4xl mb-3">👥</p>
          <p className="font-bold text-gray-700 mb-1">グループ予約はまだありません</p>
          <p className="text-sm text-gray-400">お客様がグループ予約フォームから申し込むと表示されます</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((b) => {
            const status = statusLabels[b.status] ?? statusLabels.pending;
            const spotsLeft = b.total_members - b.confirmed_members;

            return (
              <div key={b.id} className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${status.color}`}>
                        {status.label}
                      </span>
                      <span className="text-xs text-gray-400">#{b.share_code}</span>
                    </div>
                    <p className="font-bold text-gray-900">
                      {new Date(b.booking_date).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
                      {' '}{b.start_time.slice(0, 5)}〜{b.end_time.slice(0, 5)}
                    </p>
                    <p className="text-sm text-gray-600">
                      参加: {b.confirmed_members} / {b.total_members}名
                      {spotsLeft > 0 && <span className="text-amber-500 ml-1">（残{spotsLeft}名）</span>}
                    </p>
                    {b.notes && <p className="text-xs text-gray-400 truncate">{b.notes}</p>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => copyShareUrl(b.share_code)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors font-medium"
                    >
                      {copied === b.share_code ? '✓ コピー済み' : '招待リンクをコピー'}
                    </button>

                    {b.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(b.id, 'confirmed')}
                        disabled={processingId === b.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors font-bold disabled:opacity-50"
                      >
                        確定する
                      </button>
                    )}

                    {b.status === 'confirmed' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(b.id, 'completed')}
                        disabled={processingId === b.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-500 text-white hover:bg-gray-600 transition-colors font-bold disabled:opacity-50"
                      >
                        完了にする
                      </button>
                    )}

                    {!['cancelled', 'completed'].includes(b.status) && (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelId(b.id)}
                        disabled={processingId === b.id}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {facilityId && (
        <div className="bg-sky-50 rounded-xl p-5 text-sm text-sky-800 space-y-1">
          <p className="font-bold">グループ予約の仕組み</p>
          <p>• お客様が予約時に「グループ予約」を選択し、招待リンクを仲間に共有</p>
          <p>• 招待されたメンバーがリンクをクリックして参加（CareLinKアカウントが必要）</p>
          <p>• 全員が参加したら「確定」ボタンを押して予約を確定させます</p>
        </div>
      )}
      <ConfirmDialog
        open={confirmCancelId !== null}
        title="グループ予約をキャンセル"
        message="このグループ予約をキャンセルしますか？"
        confirmLabel="キャンセルする"
        cancelLabel="閉じる"
        onConfirm={() => { if (confirmCancelId) { handleStatusChange(confirmCancelId, 'cancelled'); } setConfirmCancelId(null); }}
        onCancel={() => setConfirmCancelId(null)}
      />
    </div>
  );
}
