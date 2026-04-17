'use client';

import { useState } from 'react';

const RICH_MENU_AREAS = [
  {
    id: 'bookings',
    label: '予約確認',
    icon: '📅',
    description: '予約一覧を表示',
    action: 'uri',
    uri: 'https://liff.line.me/[LIFF_ID]/bookings',
  },
  {
    id: 'new-booking',
    label: '新規予約',
    icon: '➕',
    description: '施設を選んで予約',
    action: 'uri',
    uri: 'https://carelink-jp.com/search',
  },
  {
    id: 'points',
    label: 'ポイント',
    icon: '⭐',
    description: '保有ポイントを確認',
    action: 'uri',
    uri: 'https://liff.line.me/[LIFF_ID]/points',
  },
  {
    id: 'coupons',
    label: 'クーポン',
    icon: '🎟️',
    description: '利用可能なクーポン',
    action: 'uri',
    uri: 'https://liff.line.me/[LIFF_ID]/coupons',
  },
  {
    id: 'contact',
    label: 'お問い合わせ',
    icon: '💬',
    description: 'メッセージを送る',
    action: 'message',
    text: 'お問い合わせ',
  },
  {
    id: 'cancel',
    label: 'キャンセル',
    icon: '🚫',
    description: '予約をキャンセル',
    action: 'uri',
    uri: 'https://liff.line.me/[LIFF_ID]/cancel',
  },
];

export default function LineRichMenuPage() {
  const [liffId, setLiffId] = useState('');
  const [copied, setCopied] = useState(false);

  const richMenuJson = {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'CareLink リッチメニュー',
    chatBarText: 'メニュー',
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'uri', uri: `https://liff.line.me/${liffId || '[LIFF_ID]'}/bookings` } },
      { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: 'uri', uri: 'https://carelink-jp.com/search' } },
      { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: 'uri', uri: `https://liff.line.me/${liffId || '[LIFF_ID]'}/points` } },
      { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'uri', uri: `https://liff.line.me/${liffId || '[LIFF_ID]'}/coupons` } },
      { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: 'message', text: 'お問い合わせ' } },
      { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: 'uri', uri: `https://liff.line.me/${liffId || '[LIFF_ID]'}/cancel` } },
    ],
  };

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(richMenuJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">LINE リッチメニュー設定</h1>
        <p className="text-xs text-gray-400 mt-0.5">予約確認・新規予約・ポイント確認などをLINE内で完結させるリッチメニューの設定ガイド</p>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-bold text-gray-800 mb-4">リッチメニュープレビュー</h2>
        <div className="bg-[#06C755] p-2 rounded-xl">
          <div className="grid grid-cols-3 gap-1">
            {RICH_MENU_AREAS.map((area) => (
              <div key={area.id}
                className="bg-[#05B84B] hover:bg-[#04A342] transition-colors rounded-lg p-4 text-center cursor-pointer">
                <div className="text-3xl mb-1">{area.icon}</div>
                <p className="text-white text-xs font-bold">{area.label}</p>
                <p className="text-green-100 text-[10px] mt-0.5">{area.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* LIFF ID input */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
        <h2 className="font-bold text-gray-800">設定</h2>
        <div>
          <label className="block text-xs text-gray-500 mb-1">LIFF ID（マイページ用）</label>
          <input
            type="text"
            value={liffId}
            onChange={(e) => setLiffId(e.target.value)}
            placeholder="例: 1234567890-AbCdEfGh"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <p className="text-xs text-gray-400 mt-1">LINE Developers Console → LIFF タブで確認できます</p>
        </div>
      </div>

      {/* Setup guide */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">設定手順</h2>
        <ol className="space-y-4">
          {[
            {
              step: 1,
              title: 'リッチメニュー画像を作成',
              desc: '2500×1686px の画像を作成（Canva等で可）。上記プレビューを参考に6分割レイアウトで作成してください。',
            },
            {
              step: 2,
              title: 'LINE Developers Console でリッチメニューを登録',
              desc: 'LINE Developers → Messaging API → Rich menu → Create を選択し、画像とアクションを設定します。',
            },
            {
              step: 3,
              title: '設定JSONを使用',
              desc: '以下のJSONをLINE Messaging API の POST /v2/bot/richmenu エンドポイントに送信します。',
            },
            {
              step: 4,
              title: 'デフォルトリッチメニューに設定',
              desc: 'POST /v2/bot/user/all/richmenu/{richMenuId} でユーザー全員に適用します。',
            },
          ].map((item) => (
            <li key={item.step} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-sky-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {item.step}
              </span>
              <div>
                <p className="text-sm font-bold text-gray-800">{item.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* JSON */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">設定JSON</h2>
          <button type="button" onClick={copyJson}
            className="text-xs px-3 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors font-bold">
            {copied ? '✓ コピー済み' : 'JSONをコピー'}
          </button>
        </div>
        <pre className="bg-gray-900 rounded-lg p-4 text-xs text-green-400 font-mono overflow-auto max-h-80">
          {JSON.stringify(richMenuJson, null, 2)}
        </pre>
      </div>

      <div className="bg-amber-50 rounded-xl p-4 text-xs text-amber-800">
        <p className="font-bold mb-1">注意</p>
        <p>• LIFF URLには有効なLIFF IDが必要です。上で設定してからJSONをコピーしてください。</p>
        <p>• リッチメニューは チャンネルアクセストークン（長期）で操作します。</p>
        <p>• 変更反映には数分かかる場合があります。</p>
      </div>
    </div>
  );
}
