'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Toast from '@/components/Toast';
import Link from 'next/link';
import { clearAccountLocalData, LOCAL_DATA_CLEAR_FAILED } from '@/lib/client-storage';
import { ACCOUNT_DELETION_NOTICE, FACILITY_RETIREMENT_NOTICE, ACCOUNT_DELETION_BOOKING_GUARD_NOTICE } from '@/lib/account-deletion-policy';
import { completeClientCleanupMarker, prepareClientCleanupMarker } from '@/lib/client-cleanup-marker';

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
  const [deletionConfirmed, setDeletionConfirmed] = useState(false);

  const closeModal = () => {
    setShowModal(false);
    setConfirmText('');
  };

  const handleDelete = async () => {
    if (deleting || deletionConfirmed) return;
    setDeleting(true);
    try {
      try { prepareClientCleanupMarker(); await clearAccountLocalData(); }
      catch {
        setToast({ type: 'error', message: `${LOCAL_DATA_CLEAR_FAILED} アカウントの削除は行っていません。` });
        return;
      }
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CareLink-Client-Cleanup': '1' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success === true) {
        setDeletionConfirmed(true); closeModal();
        try { await clearAccountLocalData(); completeClientCleanupMarker(); }
        catch {
          setToast({ type: 'error', message: `アカウントの削除は確認済みですが、${LOCAL_DATA_CLEAR_FAILED} 削除要求は再送しないでください。` });
          return;
        }
        // 退会（アカウント削除）成功後は router.push ではなく全ページリロードを意図的に使う。
        // 破棄したいのは【ブラウザのメモリ上にあるもの】：supabase-js のクライアント実体
        // （削除済みアカウントのトークン更新を試み続ける）と、アプリ内 state（施設情報・
        // フォーム入力値等）。router.push はどちらも残す。
        //
        // ⚠️ Cookie の破棄は全リロードの効果ではない（リロードで Cookie は消えない）。
        // 認証 Cookie を消しているのはサーバー側で、/api/account/delete が sb-*auth-token
        // だけを maxAge:0 で失効させている。membership キャッシュ Cookie（_cm_mbr_*）は
        // 残るが、middleware が先に auth.getUser() を必須にしており実害はない。
        // 退会したのに入力済みの個人情報（氏名・メール・電話）が端末に残らないよう、
        // 遷移の前に sessionStorage の下書きを消す。
        // 【全リロードでは sessionStorage は消えない】ため明示的に消す必要がある。
        window.location.href = '/';
        return;
      }
      closeModal();
      setToast({ type: 'error', message: !res.ok && typeof data?.error === 'string' ? data.error : '退会結果を確認できませんでした。再送せず、ログイン状態と受付状況を確認してください。' });
    } catch {
      closeModal();
      setToast({ type: 'error', message: '退会結果を確認できませんでした。再送せず、ログイン状態と受付状況を確認してください。' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xs p-6 sm:p-8 border border-red-100">
      <h2 className="text-lg font-bold text-red-600 mb-2">退会・データ削除</h2>
      <p className="text-xs text-gray-500 mb-4">
        {ACCOUNT_DELETION_NOTICE}
      </p>
      <p className="text-xs text-gray-500 mb-4">{FACILITY_RETIREMENT_NOTICE}</p>
      <p className="text-xs text-gray-500 mb-4">{ACCOUNT_DELETION_BOOKING_GUARD_NOTICE}</p>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        disabled={deletionConfirmed}
        className="text-xs text-red-500 hover:text-red-700 font-bold transition-colors"
      >
        退会する
      </button>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {deletionConfirmed && <p className="text-xs text-gray-600 mt-3">アカウントの削除は確認済みです。端末の下書きを確認してから<Link href="/" onClick={event => { event.preventDefault(); window.location.assign(window.location.origin); }} className="ml-1 underline">トップページへ進む</Link>ことができます。</p>}

      {showModal && (
        <Modal open onClose={() => { if (!deleting) closeModal(); }} title="退会する" maxWidthClass="max-w-sm">
          <p className="text-sm text-gray-600 mb-4">
            {ACCOUNT_DELETION_NOTICE}
          </p>
          <p className="text-xs text-gray-600 mb-4">{FACILITY_RETIREMENT_NOTICE}</p>
          <p className="text-xs text-gray-600 mb-4">{ACCOUNT_DELETION_BOOKING_GUARD_NOTICE}</p>
          <p className="text-xs font-medium text-gray-700 mb-2">
            確認のため「<span className="font-bold text-red-600">DELETE</span>」と入力してください
          </p>
          <input
            type="text"
            value={confirmText}
            disabled={deleting}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-label="確認コード DELETE を入力"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 font-mono"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={closeModal}
              disabled={deleting}
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
