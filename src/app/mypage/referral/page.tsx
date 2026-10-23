'use client';

import { useEffect, useState } from 'react';
import { useConfirmedClipboard } from '@/hooks/useConfirmedClipboard';
import Toast from '@/components/Toast';
import Button from '@/components/ui/Button';
import { referralCodeFromParam, referralShareText } from '@/lib/referral-code';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://carelink-jp.com';

export default function ReferralPage() {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);
  const [alreadyReferred, setAlreadyReferred] = useState(false);
  const [loading, setLoading] = useState(true);
  // 取得失敗を握り潰すと「紹介コード未発行・0人」と障害が区別不能になるため明示する
  const [loadError, setLoadError] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [applying, setApplying] = useState(false);
  // 共有リンク（?ref=）で届いたコードを入力欄へ入れたか。押す前に確かめてもらうための案内に使う。
  const [prefilledFromLink, setPrefilledFromLink] = useState(false);
  const clipboard=useConfirmedClipboard(referralCode);
  const copied=clipboard.status==='copied';
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/referral')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => {
        setReferralCode(d.code ?? null);
        setInvitedCount(d.used_count ?? 0);
        setAlreadyReferred(d.already_referred ?? false);
        // 共有リンクのコードを入力欄へ入れる。自動では適用しない（来店済みの方は断られるため、
        // 押す前に内容を確かめてもらう）。適用済みの方・自分のコードのリンクを開いた方には入れない。
        const linked = referralCodeFromParam(new URLSearchParams(window.location.search).get('ref'));
        if (linked && !d.already_referred && linked !== d.code) {
          setInputCode(linked);
          setPrefilledFromLink(true);
        }
        setLoading(false);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  const copyCode=()=>{if(referralCode)void clipboard.copy(referralCode);};

  const shareUrl = `${SITE_URL}?ref=${referralCode ?? ''}`;

  // 共有文は利用条件（初回のご予約の前に入力）まで書く（src/lib/referral-code.ts）。
  const shareText = referralShareText(referralCode ?? '');

  const shareOnX = () => {
    const text = encodeURIComponent(shareText);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener');
  };

  const shareOnLine = () => {
    const text = encodeURIComponent(`${shareText} ${shareUrl}`);
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
        setToast({ type: 'success', message: body.message || '紹介コードを適用しました。初回のご予約完了で300ポイントが付与されます。' });
        setAlreadyReferred(true);
        setInputCode('');
        setPrefilledFromLink(false);
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
        <div className="h-8 bg-gray-200 rounded-sm w-1/3" />
        <div className="h-32 bg-gray-200 rounded-2xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-12">
        <p role="alert" className="text-red-600 text-sm">
          招待情報の取得に失敗しました。時間をおいて再度お試しください。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">友達招待プログラム</h1>

      {/* ポイント説明 */}
      {/* 白文字は sky-700 の上で 5.93:1（AA の 4.5:1 以上）。半透明にすると下回るので不透明のまま使う */}
      <div className="bg-linear-to-br from-sky-700 to-sky-800 text-white rounded-2xl p-6">
        <p className="text-sm mb-2">友達を招待すると</p>
        <p className="text-3xl font-bold">あなたに500pt・友達に300pt</p>
        <p className="text-sm mt-1">友達の初回のご予約完了で、招待した方・された方の両方にポイントをプレゼント</p>
      </div>

      {/* 自分の紹介コード */}
      {referralCode && (
        <div className="bg-white rounded-2xl shadow-xs p-6">
          <h2 className="text-base font-bold text-gray-800 mb-4">あなたの紹介コード</h2>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 text-center">
              <p className="text-2xl font-mono font-bold tracking-widest text-sky-700">{referralCode}</p>
            </div>
            <Button
              onClick={copyCode} disabled={clipboard.copying}
              className="shrink-0"
            >
              {clipboard.copying?'コピー中...':copied ? 'コピー済み' : 'コピー'}
            </Button>
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

      {clipboard.status==='failed'&&<p role="alert" className="text-sm text-red-600">紹介コードをコピーできませんでした。コードを選択してコピーするか、ブラウザの権限をご確認ください。</p>}

      {/* 紹介コード入力（未使用の場合のみ） */}
      {!alreadyReferred ? (
        <div className="bg-white rounded-2xl shadow-xs p-6">
          <h2 className="text-base font-bold text-gray-800 mb-2">紹介コードを入力する</h2>
          <p className="text-xs text-gray-500 mb-4">友達から紹介コードをもらったら、初回のご予約の前に入力してください。初回のご予約完了で300ポイントをプレゼントします。</p>
          <div className="flex gap-3">
            <input
              type="text"
              value={inputCode}
              onChange={(e) => { setInputCode(e.target.value.toUpperCase()); setPrefilledFromLink(false); }}
              placeholder="例: ABCD2345"
              maxLength={8}
              className="flex-1 form-input font-mono tracking-widest text-center uppercase"
            />
            <Button
              onClick={applyCode}
              disabled={!inputCode.trim() || applying}
              className="shrink-0"
            >
              {applying ? '適用中...' : '適用'}
            </Button>
          </div>
          {prefilledFromLink && (
            <p className="text-xs text-sky-700 mt-2">紹介リンクのコードを入力しました。内容をご確認のうえ「適用」を押してください。</p>
          )}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
          <p className="text-sm text-green-700 font-medium">紹介コード適用済みです</p>
        </div>
      )}

      {/* 使い方 */}
      <div className="bg-white rounded-2xl shadow-xs p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">使い方</h2>
        <ol className="space-y-3">
          {[
            '上記の紹介コードを友達に教える',
            '友達がCareLinkに登録し、初回のご予約の前に紹介コードを入力',
            '友達の初回のご予約完了で、友達に300pt・あなたに500ptを自動でプレゼント',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-500 mt-4">※ポイントは招待1人につき1回のみ付与されます。</p>
        <p className="text-xs text-gray-500 mt-1">※紹介コードは初回のご来店前の方のみご利用いただけます。</p>
        <p className="text-xs text-gray-500 mt-1">※ご予約の完了が取り消された場合（無断キャンセルへの訂正など）は、紹介のポイントも取り消されます。</p>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
