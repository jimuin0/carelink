'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';

/**
 * 施設オーナー向け退会（アカウント・データ削除）セクション。
 * POST /api/account/delete を呼ぶ。サーバ側ガードで未完了予約が残る間は 409 を返すため、
 * その文面をトーストでそのまま提示する（「予約が残る間は退会不可」を利用者に明示）。
 */
export default function WithdrawalSettings() {
  const [showModal, setShowModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const closeModal = () => {
    setShowModal(false);
    setConfirmText('');
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      const data = await res.json().catch(() => ({}));
      closeModal();
      setToast({ type: 'error', message: data.error || '退会処理に失敗しました' });
    } catch {
      closeModal();
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 border border-red-100">
      <h2 className="text-lg font-bold text-red-600 mb-2">退会・データ削除</h2>
      <p className="text-xs text-gray-500 mb-4">
        退会すると施設は非公開になり、アカウントと個人データが削除されます。この操作は取り消せません。
        未完了の予約が残っている間は退会できません（予約の完了またはキャンセル後に行ってください）。
      </p>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="text-xs text-red-500 hover:text-red-700 font-bold transition-colors"
      >
        退会する
      </button>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {showModal && (
        <Modal open onClose={closeModal} title="退会する" maxWidthClass="max-w-sm">
          <p className="text-sm text-gray-600 mb-4">
            施設が非公開になり、アカウントと個人データが完全に削除されます。この操作は取り消せません。
          </p>
          <p className="text-xs font-medium text-gray-700 mb-2">
            確認のため「<span className="font-bold text-red-600">DELETE</span>」と入力してください
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="確認コード DELETE を入力"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 font-mono"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={confirmText !== 'DELETE' || deleting}
              onClick={handleDelete}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600 disabled:opacity-40 transition-colors"
            >
              {deleting ? '退会処理中...' : '退会する'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
