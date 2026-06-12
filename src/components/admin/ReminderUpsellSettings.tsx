'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

/**
 * リマインダー設定＋有料オプション（アップセル）セクション
 *
 * - 7日前メール: 無料（トグルのみ）
 * - 3日前メール: 有料オプション reminder_email_3d 購入で解放
 * - 3日前・7日前LINE: 有料オプション reminder_line 購入で解放
 * - 未購入の有料項目は 🔒＋月額（option_catalog の仮価格・DB変更可）＋購入ボタンを表示
 * - HPB 連携など contact_only オプションは「申込み（要相談）」ボタン
 *
 * 価格・購入状態はサーバ（RLS）から取得。購入は /api/options/checkout（Stripe）、
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
const ROWS: { key: keyof ReminderSettings; label: string; requires: string | null }[] = [
  { key: 'remind_7d_email', label: '7日前リマインドメール', requires: null }, // 無料
  { key: 'remind_3d_email', label: '3日前リマインドメール', requires: 'reminder_email_3d' },
  { key: 'remind_7d_line', label: '7日前リマインドLINE', requires: 'reminder_line' },
  { key: 'remind_3d_line', label: '3日前リマインドLINE', requires: 'reminder_line' },
];

export default function ReminderUpsellSettings({ facilityId }: { facilityId: string }) {
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_SETTINGS);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [entitled, setEntitled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inquired, setInquired] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();

      const [{ data: settingsRow }, { data: catalogRows }, { data: entRows }] = await Promise.all([
        supabase.from('facility_reminder_settings').select('*').eq('facility_id', facilityId).maybeSingle(),
        supabase.from('option_catalog').select('key, name, description, monthly_price, contact_only, sort_order').eq('is_active', true).order('sort_order', { ascending: true }),
        supabase.from('facility_entitlements').select('option_key, status').eq('facility_id', facilityId).eq('status', 'active'),
      ]);

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
    load().catch(() => setLoading(false));
  }, [facilityId]);

  const priceOf = (key: string): number | null =>
    catalog.find((c) => c.key === key)?.monthly_price ?? null;

  const handleToggle = async (key: keyof ReminderSettings) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    setSaving(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { error: upsertErr } = await supabase
      .from('facility_reminder_settings')
      .upsert({ facility_id: facilityId, ...newSettings }, { onConflict: 'facility_id' });

    if (upsertErr) {
      // 保存失敗は silent にせず巻き戻して可視化（楽観更新の取り消し）
      setSettings(settings);
      setError('設定の保存に失敗しました。時間をおいて再度お試しください。');
    }
    setSaving(false);
  };

  const handleBuy = async (optionKey: string, contactOnly: boolean) => {
    setBuying(optionKey);
    setError(null);
    try {
      const endpoint = contactOnly ? '/api/options/inquiry' : '/api/options/checkout';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, optionKey }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '処理に失敗しました。');
      } else if (contactOnly) {
        setInquired((prev) => new Set(prev).add(optionKey));
      } else if (json.url) {
        window.location.href = json.url; // Stripe Checkout へ
      } else {
        setError('決済URLを取得できませんでした。');
      }
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setBuying(null);
    }
  };

  if (loading) return <div className="h-56 bg-gray-50 rounded-lg animate-pulse" data-testid="reminder-upsell-loading" />;

  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-sm font-bold text-gray-800 mb-1">リマインダー設定</h3>
      <p className="text-xs text-gray-500 mb-4">前日リマインドメールは全プラン共通で自動送信されます（無料）。</p>

      <div className="space-y-3 mb-6">
        {ROWS.map(({ key, label, requires }) => {
          const locked = requires !== null && !entitled.has(requires);
          const price = requires !== null ? priceOf(requires) : null;
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {label}
                {requires === null ? (
                  <span className="ml-2 text-[10px] font-bold text-emerald-600 border border-emerald-200 bg-emerald-50 rounded px-1.5 py-0.5">無料</span>
                ) : (
                  <span className="ml-2 text-[10px] font-bold text-amber-600 border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5">
                    有料{price !== null ? `・月額¥${price.toLocaleString()}` : ''}
                  </span>
                )}
              </span>
              {locked ? (
                <span className="text-xs text-gray-400" data-testid={`locked-${key}`}>🔒 未購入</span>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings[key]}
                  aria-label={label}
                  onClick={() => handleToggle(key)}
                  disabled={saving}
                  className={`relative w-11 h-6 rounded-full transition-colors ${settings[key] ? 'bg-sky-500' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${settings[key] ? 'translate-x-5' : ''}`} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-bold text-gray-800 mb-1">有料オプション</h3>
      <p className="text-xs text-gray-500 mb-4">必要な機能だけ月額で追加できます（いつでも解約可能）。</p>

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
                  {opt.contact_only && <span className="text-gray-400 font-normal">〜（個別お見積り）</span>}
                </p>
              </div>
              {owned ? (
                <span className="shrink-0 text-xs font-bold text-emerald-600 border border-emerald-200 bg-emerald-50 rounded px-2 py-1">利用中</span>
              ) : requested ? (
                <span className="shrink-0 text-xs font-bold text-sky-600 border border-sky-200 bg-sky-50 rounded px-2 py-1">申込み済み</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuy(opt.key, opt.contact_only)}
                  disabled={buying !== null}
                  className="shrink-0 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded px-3 py-1.5"
                >
                  {buying === opt.key ? '処理中...' : opt.contact_only ? '申込み（要相談）' : '購入する'}
                </button>
              )}
            </div>
          );
        })}
        {catalog.length === 0 && (
          <p className="text-xs text-gray-400">現在ご利用可能なオプションはありません。</p>
        )}
      </div>

      {saving && <p className="text-xs text-gray-400 mt-2">保存中...</p>}
      {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}
    </div>
  );
}
