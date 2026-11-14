'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toggle from '@/components/admin/Toggle';
import LoadError from '@/components/admin/LoadError';
import { isLineEnabled } from '@/lib/line-availability';
import { loadPayjp, type PayjpCardElement, type PayjpClient } from '@/lib/payjp-client';

/**
 * リマインダー設定＋有料オプション（アップセル）セクション
 *
 * - 7日前メール: 無料（トグルのみ）
 * - 3日前メール: 有料オプション reminder_email_3d 購入で解放
 * - 3日前・7日前LINE: 有料オプション reminder_line 購入で解放
 * - 未購入の有料項目は 🔒＋月額（option_catalog の仮価格・DB変更可）＋購入ボタンを表示
 * - HPB 連携など contact_only オプションは「申込み（要相談）」ボタン
 *
 * 価格・購入状態はサーバ（RLS）から取得。購入はカード入力欄（payjp.js）でトークンを作り /api/options/checkout（PAY.JP の月額）、
 * 申込みは /api/options/inquiry（Slack 通知）へ POST する。
 */

interface ReminderSettings {
  remind_7d_email: boolean;
  remind_3d_email: boolean;
  remind_7d_line: boolean;
  remind_3d_line: boolean;
}

interface CatalogOption {
  key: string;
  name: string;
  description: string | null;
  monthly_price: number;
  contact_only: boolean;
  sort_order: number;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  remind_7d_email: false,
  remind_3d_email: false,
  remind_7d_line: false,
  remind_3d_line: false,
};

/** 設定行の定義: どのトグルがどのオプション購入を必要とするか */
const ALL_ROWS: { key: keyof ReminderSettings; label: string; requires: string | null }[] = [
  { key: 'remind_7d_email', label: '7日前リマインドメール', requires: null }, // 無料
  { key: 'remind_3d_email', label: '3日前リマインドメール', requires: 'reminder_email_3d' },
  { key: 'remind_7d_line', label: '7日前リマインドLINE', requires: 'reminder_line' },
  { key: 'remind_3d_line', label: '3日前リマインドLINE', requires: 'reminder_line' },
];

/**
 * LINE リマインドは、施設が課金しても顧客側に LINE 連携の導線が無ければ一通も届かない。
 * ローンチ段階では LINE を設定しない方針のため、LIFF 未設定の間は行ごと出さない
 * （設定すれば自動で戻る。判定理由は lib/line-availability.ts）。
 * DB 列・cron 側の分岐は触らない：表示だけを実態に合わせ、後で有効化したときに
 * 保存済みの設定がそのまま生きるようにする。
 */
const ROWS = ALL_ROWS.filter((r) => isLineEnabled() || !r.key.endsWith('_line'));

export default function ReminderUpsellSettings({ facilityId }: { facilityId: string }) {
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [entitled, setEntitled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // 設定・購入状況を読めなかったら操作させない（既定値 false のまま保存して実際の設定を消さないため）。
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inquired, setInquired] = useState<Set<string>>(new Set());
  // 購入するオプション（カード入力欄を開いている）と、payjp.js の公開鍵（カタログ API が返す）。
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const payjpRef = useRef<{ client: PayjpClient; card: PayjpCardElement } | null>(null);

  // カード入力欄を開いたときだけ payjp.js を読み込み、PAY.JP の iframe を差し込む（カード番号は CareLink を通らない）。
  useEffect(() => {
    if (!cardFor || !publicKey) return;
    let disposed = false;
    loadPayjp().then((Payjp) => {
      if (disposed) return;
      const client = Payjp(publicKey);
      const card = client.elements().create('card');
      card.mount('#option-card');
      payjpRef.current = { client, card };
      setCardReady(true);
    }).catch(() => {
      if (!disposed) setError('カード入力欄を読み込めませんでした。再読み込みしてください。');
    });
    return () => {
      disposed = true;
      payjpRef.current?.card.unmount();
      payjpRef.current = null;
      setCardReady(false);
    };
  }, [cardFor, publicKey]);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();

      // カタログは option_catalog を直接読まず /api/options/catalog を通す。
      // 購入可否を決めるのはサーバの決済設定（PAY.JP の鍵）で、クライアントからは見えないため。
      // 決済未設定の間、サーバが購入必須オプションを返さないので「買えない商品に値札と
      // 購入ボタンを出して 503 を踏ませる」状態が構造的に起きない（2026年7月30日 是正）。
      const [{ data: settingsRow, error: settingsErr }, catalogRes, { data: entRows, error: entErr }] = await Promise.all([
        supabase.from('facility_reminder_settings').select('*').eq('facility_id', facilityId).maybeSingle(),
        fetch('/api/options/catalog').then((r) => (r.ok ? r.json() : { options: [] })).catch(() => ({ options: [] })),
        supabase.from('facility_entitlements').select('option_key, status').eq('facility_id', facilityId).eq('status', 'active'),
      ]);
      const catalogRows = (catalogRes as { options?: CatalogOption[] }).options ?? [];
      setPublicKey((catalogRes as { publicKey?: string }).publicKey ?? null);
      if (settingsErr || entErr) {
        setLoadFailed(true);
        setLoading(false);
        return;
      }
      setLoadFailed(false);

      if (settingsRow) {
        setSettings({
          remind_7d_email: settingsRow.remind_7d_email,
          remind_3d_email: settingsRow.remind_3d_email,
          remind_7d_line: settingsRow.remind_7d_line,
          remind_3d_line: settingsRow.remind_3d_line,
        });
      }
      setCatalog((catalogRows as CatalogOption[]) ?? []);
      setEntitled(new Set(((entRows as { option_key: string }[]) ?? []).map((e) => e.option_key)));
      setLoading(false);
    };
    load().catch(() => { setLoadFailed(true); setLoading(false); });
  }, [facilityId, reloadKey]);

  const priceOf = (key: string): number | null =>
    catalog.find((c) => c.key === key)?.monthly_price ?? null;

  const handleToggle = async (key: keyof ReminderSettings) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    setSaving(true);
    setError(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error: upsertErr } = await supabase
        .from('facility_reminder_settings')
        // 切り替えた列だけを書く（他の列を画面の値で上書きしない）。
        .upsert({ facility_id: facilityId, [key]: newSettings[key] } as { facility_id: string } & Partial<ReminderSettings>, { onConflict: 'facility_id' });

      if (upsertErr) {
        // 保存失敗は silent にせず巻き戻して可視化（楽観更新の取り消し）
        setSettings(settings);
        setError('設定の保存に失敗しました。時間をおいて再度お試しください。');
      }
    } catch {
      // 通信断（例外）でも巻き戻し、トグルを無効のまま固めない（監査 A267）
      setSettings(settings);
      setError('設定の保存に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  const handleBuy = async (optionKey: string, contactOnly: boolean) => {
    setError(null);
    setNotice(null);
    if (!contactOnly) {
      // 月額の購入はカード入力欄を開く（申込は handleSubscribe）。
      setCardFor(optionKey);
      return;
    }
    setBuying(optionKey);
    try {
      const res = await fetch('/api/options/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, optionKey }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || '処理に失敗しました。');
      else setInquired((prev) => new Set(prev).add(optionKey));
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setBuying(null);
    }
  };

  const handleSubscribe = async () => {
    const payjp = payjpRef.current;
    const optionKey = cardFor;
    if (!payjp || !optionKey || buying) return;
    setBuying(optionKey);
    setError(null);
    try {
      const tokenResult = await payjp.client.createToken(payjp.card).catch(() => ({ id: undefined, error: { message: undefined } }));
      if (!tokenResult.id) {
        setError(tokenResult.error?.message || 'カード情報を確認できませんでした。');
        return;
      }
      const res = await fetch('/api/options/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, optionKey, token: tokenResult.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '処理に失敗しました。');
        return;
      }
      setCardFor(null);
      if (json.active) {
        setEntitled((prev) => new Set(prev).add(optionKey));
        setNotice('お申し込みが完了しました。');
      } else {
        setNotice('お申し込みを受け付けました。決済の確認後に利用できるようになります（数分かかることがあります）。');
      }
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setBuying(null);
    }
  };

  if (loading) return <div className="h-56 bg-gray-50 rounded-lg animate-pulse" data-testid="reminder-upsell-loading" />;
  if (loadFailed) {
    return <LoadError message="リマインダー設定の読み込みに失敗しました" onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }} />;
  }

  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-sm font-bold text-gray-800 mb-1">リマインダー設定</h3>
      <p className="text-xs text-gray-500 mb-4">リマインドは毎朝9時に、その時点のご予約へ送信します。前日リマインドメールは全プラン共通で自動送信されます（無料）。</p>

      <div className="space-y-3 mb-6">
        {ROWS.map(({ key, label, requires }) => {
          const locked = requires !== null && !entitled.has(requires);
          const price = requires !== null ? priceOf(requires) : null;
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {label}
                {requires === null ? (
                  <span className="ml-2 text-[10px] font-bold text-emerald-600 border border-emerald-200 bg-emerald-50 rounded-sm px-1.5 py-0.5">無料</span>
                ) : (
                  <span className="ml-2 text-[10px] font-bold text-amber-600 border border-amber-200 bg-amber-50 rounded-sm px-1.5 py-0.5">
                    有料{price !== null ? `・月額¥${price.toLocaleString()}` : ''}
                  </span>
                )}
              </span>
              {locked ? (
                <span className="text-xs text-gray-500" data-testid={`locked-${key}`}>🔒 未購入</span>
              ) : (
                <Toggle checked={settings[key]} onChange={() => handleToggle(key)} disabled={saving} label={label} />
              )}
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-bold text-gray-800 mb-1">有料オプション</h3>
      <p className="text-xs text-gray-500 mb-4">必要な機能だけ月額で追加できます。カードで毎月自動でお支払いいただきます（解約はお問い合わせからご連絡ください）。</p>

      <div className="space-y-3">
        {catalog.map((opt) => {
          const owned = entitled.has(opt.key);
          const requested = inquired.has(opt.key);
          return (
            <div key={opt.key} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{opt.name}</p>
                {opt.description && <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>}
                <p className="text-xs font-bold text-gray-700 mt-1">
                  月額 ¥{opt.monthly_price.toLocaleString()}
                  {opt.contact_only && <span className="text-gray-500 font-normal">〜（個別お見積り）</span>}
                </p>
              </div>
              {owned ? (
                <span className="shrink-0 text-xs font-bold text-emerald-600 border border-emerald-200 bg-emerald-50 rounded-sm px-2 py-1">利用中</span>
              ) : requested ? (
                <span className="shrink-0 text-xs font-bold text-sky-600 border border-sky-200 bg-sky-50 rounded-sm px-2 py-1">申込み済み</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuy(opt.key, opt.contact_only)}
                  disabled={buying !== null}
                  className="shrink-0 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-sm px-3 py-1.5"
                >
                  {buying === opt.key ? '処理中...' : opt.contact_only ? '申込み（要相談）' : '購入する'}
                </button>
              )}
            </div>
          );
        })}
        {catalog.length === 0 && (
          <p className="text-xs text-gray-500">現在ご利用可能なオプションはありません。</p>
        )}
      </div>

      {cardFor && (
        <div className="mt-4 border border-gray-200 rounded-lg p-4" data-testid="option-card-panel">
          <p className="text-sm font-semibold text-gray-800 mb-2">
            {catalog.find((c) => c.key === cardFor)?.name}（月額 ¥{(priceOf(cardFor) ?? 0).toLocaleString()}）のお支払いカード
          </p>
          <div id="option-card" className="border border-gray-200 rounded-sm p-2 min-h-10" />
          <p className="text-[11px] text-gray-500 mt-1">カード情報は決済代行の PAY.JP に送られ、CareLink には保存されません。</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={handleSubscribe} disabled={!cardReady || buying !== null}
              className="text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-sm px-3 py-1.5">
              {buying ? '処理中...' : '申し込む'}
            </button>
            <button type="button" onClick={() => setCardFor(null)} disabled={buying !== null}
              className="text-xs text-gray-600 border border-gray-200 rounded-sm px-3 py-1.5">やめる</button>
          </div>
        </div>
      )}

      {saving && <p className="text-xs text-gray-500 mt-2">保存中...</p>}
      {notice && <p className="text-xs text-emerald-700 mt-2" role="status">{notice}</p>}
      {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}
    </div>
  );
}
