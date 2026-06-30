'use client';

import { useState, useEffect, useCallback } from 'react';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';

interface Salon {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string;
}

export default function AdminRegistrationsPage() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmRejectSalon, setConfirmRejectSalon] = useState<Salon | null>(null);

  const loadSalons = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch('/api/admin/registrations');
      if (!res.ok) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      const json = await res.json();
      setSalons(json.salons ?? []);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSalons(); }, [loadSalons]);

  const updateStatus = async (salon: Salon, status: 'approved' | 'rejected') => {
    if (processingId) return; // 二重送信ガード（連打・処理中の別操作を抑止）
    setProcessingId(salon.id);
    try {
      const res = await fetch(`/api/admin/registrations/${salon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const label = status === 'approved' ? '承認' : '却下';
        setToast({ type: 'error', message: `${label}に失敗しました` });
        return;
      }
      const label = status === 'approved' ? '承認' : '却下';
      setToast({ type: 'success', message: `${salon.name}を${label}しました` });
      loadSalons();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleApprove = (salon: Salon) => updateStatus(salon, 'approved');

  const handleReject = (salon: Salon) => {
    setConfirmRejectSalon(salon);
    setConfirmReject(true);
  };

  const doReject = async () => {
    if (!confirmRejectSalon) return;
    setConfirmReject(false);
    const salon = confirmRejectSalon;
    setConfirmRejectSalon(null);
    await updateStatus(salon, 'rejected');
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'pending': return { text: '審査中', cls: 'bg-yellow-100 text-yellow-700' };
      case 'approved': return { text: '承認済', cls: 'bg-green-100 text-green-700' };
      case 'rejected': return { text: '却下', cls: 'bg-red-100 text-red-700' };
      default: return { text: s, cls: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div>
      <SbPageHeader title="施設登録管理" />

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
        </div>
      ) : loadError ? (
        <LoadError onRetry={loadSalons} message="登録申請の読み込みに失敗しました" />
      ) : salons.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">登録申請はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {salons.map((salon) => {
            const st = statusLabel(salon.status);
            return (
              <div key={salon.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(salon.created_at).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <p className="font-bold">{salon.name}</p>
                    <p className="text-xs text-gray-500">{salon.email}{salon.phone ? ` / ${salon.phone}` : ''}</p>
                  </div>
                  {salon.status === 'pending' && (
                    <div className="flex gap-2">
                      <button type="button" disabled={processingId !== null} onClick={() => handleApprove(salon)} className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">承認</button>
                      <button type="button" disabled={processingId !== null} onClick={() => handleReject(salon)} className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-lg hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed">却下</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmDialog
        open={confirmReject}
        title="施設を却下"
        message={`${confirmRejectSalon?.name}を却下しますか？`}
        confirmLabel="却下する"
        onConfirm={doReject}
        onCancel={() => { setConfirmReject(false); setConfirmRejectSalon(null); }}
      />
    </div>
  );
}
