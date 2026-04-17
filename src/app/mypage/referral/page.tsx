'use client';

import { useEffect, useState } from 'react';
import Toast from '@/components/Toast';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://carelink-jp.com';

export default function ReferralPage() {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);
  const [alreadyReferred, setAlreadyReferred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputCode, setInputCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/referral')
      .then((r) => r.json())
      .then((d) => {
        setReferralCode(d.code ?? null);
        setInvitedCount(d.used_count ?? 0);
        setAlreadyReferred(d.already_referred ?? false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const copyCode = async () => {
    if (!referralCode) return;
    await navigator.clipboard.writeText(referralCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareUrl = `${SITE_URL}?ref=${referralCode ?? ''}`;

  const shareOnX = () => {
    const text = encodeURIComponent(`CareLinkで健康・美容施設を予約しよう！紹介コード「${referralCode}」で${300}ポイントもらえます🎁`);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener');
  };

  const shareOnLine = () => {
    const text = encodeURIComponent(`CareLinkで健康・美容施設を予約しよう！紹介コード「${referralCode}」で${300}ポイントもらえます🎁 ${shareUrl}`);
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}&text=${text}`, '_blank', 'noopener');
  };

  const applyCode = async () => {
    if (!inputCode.trim() || applying) return;
    setApplying(true);
    try {
      const res = await fetch('/api/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inputCode.trim().toUpperCase() }),
      });
      const body = await res.json();
      if (res.ok) {
        setToast({ type: 'success', message: `紹介コードを適用しました！${body.message || '300ポイント獲得'}` });
        setAlreadyReferred(true);
        setInputCode('');
      } else {
        setToast({ type: 'error', message: body.error || '適用に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">友達招待プログラム</h1>

      {/* ポイント説明 */}
      <div className="bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-2xl p-6">
        <p className="text-sm opacity-90 mb-2">友達を招待すると</p>
        <p className="text-3xl font-bold">双方に 300pt</p>
        <p className="text-sm opacity-80 mt-1">招待した方・された方、両方にポイントをプレゼント</p>
      </div>

      {/* 自分の紹介コード */}
      {referralCode && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">あなたの紹介コード</h2>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 text-center">
              <p className="text-2xl font-mono font-bold tracking-widest text-sky-600">{referralCode}</p>
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="px-4 py-3 rounded-xl bg-sky-500 text-white text-sm font-bold hover:bg-sky-600 transition-colors shrink-0"
            >
              {copied ? 'コピー済み' : 'コピー'}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={shareOnX}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              X(Twitter)でシェア
            </button>
            <button
              type="button"
              onClick={shareOnLine}
              className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-sm font-bold hover:bg-green-600 transition-colors"
            >
              LINEでシェア
            </button>
          </div>
          {invitedCount > 0 && (
            <p className="text-xs text-gray-500 text-center mt-3">これまでに {invitedCount}人 を招待しました</p>
          )}
        </div>
      )}

      {/* 紹介コード入力（未使用の場合のみ） */}
      {!alreadyReferred ? (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-bold text-gray-800 mb-2">紹介コードを入力する</h2>
          <p className="text-xs text-gray-500 mb-4">友達から紹介コードをもらったら入力してください。300ポイントをプレゼントします。</p>
          <div className="flex gap-3">
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="例: ABCD12"
              maxLength={8}
              className="flex-1 form-input font-mono tracking-widest text-center uppercase"
            />
            <button
              type="button"
              onClick={applyCode}
              disabled={!inputCode.trim() || applying}
              className="px-5 py-2.5 rounded-xl bg-sky-500 text-white text-sm font-bold hover:bg-sky-600 disabled:opacity-50 transition-colors shrink-0"
            >
              {applying ? '適用中...' : '適用'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
          <p className="text-sm text-green-700 font-medium">紹介コード適用済みです</p>
        </div>
      )}

      {/* 使い方 */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">使い方</h2>
        <ol className="space-y-3">
          {[
            '上記の紹介コードを友達に教える',
            '友達がCareLinkに登録後、紹介コードを入力',
            '友達に300pt・あなたに300ptを自動でプレゼント',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-400 mt-4">※ポイントは招待1人につき1回のみ付与されます。</p>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
