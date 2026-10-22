'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import LoadError from '@/components/admin/LoadError';
import { CANCEL_POLICY_DEFAULTS, CANCEL_RULES, resolveCancelPolicy, type CancelRule } from '@/lib/cancel-fee';

interface Policy {
  free_cancel_hours: number;
  late_cancel_rate: number;
  no_show_rate: number;
  policy_text: string;
  /** null は 2026年10月23日より前に保存された行（free_cancel_hours から解釈し、保存時に明示の値で書き直す）。 */
  cancel_rule: CancelRule | null;
}

const DEFAULT: Policy = {
  ...CANCEL_POLICY_DEFAULTS,
  policy_text: '',
  cancel_rule: null,
};

/** 「N時間前まで無料」で選べる時間。 */
const FREE_WINDOW_HOURS = [12, 24, 48, 72];

/**
 * キャンセルの受け付け方の選択肢。どれを選んだときに何が起きるかは src/lib/cancel-fee.ts の
 * resolveCancelPolicy が唯一の解釈で、予約画面の案内・キャンセル料の計算・キャンセル API も同じ解釈を使う。
 * 以前の「キャンセル不可」（free_cancel_hours=0）は、予約画面では「常にキャンセル料」、計算では
 * 「いつでも無料」と別の意味に読まれていたため、2つの選択肢に分けた（2026年10月22日・神原さん判断
 * 「店舗側の設定に任せる」）。
 */
const RULE_OPTION_LABEL: Record<Exclude<CancelRule, 'free_window'>, string> = {
  always_fee: '期限なし（キャンセル時は常にキャンセル料）',
  no_online: 'ネットでのキャンセル不可（店舗へ直接ご連絡）',
};

/** 保存されているポリシーを選択肢の値（"12" などの時間か、ルール名）にする。 */
function ruleSelectValue(policy: Policy): string {
  const resolved = resolveCancelPolicy(policy);
  return resolved.rule === 'free_window' ? String(resolved.freeHours) : resolved.rule;
}

function isCancelRule(value: unknown): value is CancelRule {
  return (CANCEL_RULES as readonly unknown[]).includes(value);
}

export default function CancelPolicySettings({ facilityId }: { facilityId: string }) {
  const [policy, setPolicy] = useState<Policy>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // React Compiler の set-state-in-effect 対策：useCallback + 呼び出し という形は
  // 「effect が外部関数を呼び、その中で setState する」構造として検出されるため、
  // 取得処理を effect 本体へ直接 inline し、再取得は reloadKey（state）で駆動する。
  // 挙動は従来と同一（マウント時取得・facilityId 変化時再取得・再試行ボタンで再取得）。
  const [reloadKey, setReloadKey] = useState(0);
  const retry = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data, error } = await supabase
        .from('facility_cancel_policies')
        .select('*')
        .eq('facility_id', facilityId)
        .maybeSingle();

      if (cancelled) return;
      if (error) { setLoadError(true); setLoading(false); return; }
      if (data) {
        // 3列とも DEFAULT 付きだが NOT NULL ではない（migration 20260405000003：
        // free_cancel_hours INT DEFAULT 24 / late_cancel_rate INT DEFAULT 50 /
        // no_show_rate INT DEFAULT 100）。明示的に NULL が入った行では null が返る。
        // そのまま number として扱うと入力欄が空になり、保存すると「無料キャンセル期限なし」
        // として書き戻されてしまうため、DB 側の DEFAULT と同値である DEFAULT 定数へ倒す
        // （キャンセル料の計算・予約画面の案内も同じ既定値で解釈する＝CANCEL_POLICY_DEFAULTS）。
        setPolicy({
          free_cancel_hours: data.free_cancel_hours ?? DEFAULT.free_cancel_hours,
          late_cancel_rate: data.late_cancel_rate ?? DEFAULT.late_cancel_rate,
          no_show_rate: data.no_show_rate ?? DEFAULT.no_show_rate,
          policy_text: data.policy_text || '',
          cancel_rule: isCancelRule(data.cancel_rule) ? data.cancel_rule : null,
        });
      }
      setLoading(false);
    })().catch(() => {
      if (!cancelled) { setLoadError(true); setLoading(false); }
    });
    // アンマウント後（cleanup 実行後）の setState を発生させないための cancelled ガード。
    return () => { cancelled = true; };
  }, [facilityId, reloadKey]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(false);
    const supabase = createBrowserSupabaseClient();
    // 画面に表示している選択（旧い行の解釈を含む）を cancel_rule として明示的に保存する。
    const { error } = await supabase
      .from('facility_cancel_policies')
      .upsert({ facility_id: facilityId, ...policy, cancel_rule: resolveCancelPolicy(policy).rule }, { onConflict: 'facility_id' });
    setSaving(false);
    // 返金率に直結する設定。保存失敗を成功と偽装せず、失敗は明示する。
    if (error) { setSaveError(true); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="h-40 bg-gray-50 rounded-lg animate-pulse" />;

  // 取得失敗時はフォームを描画しない（DEFAULT値を upsert で保存して実ポリシーを上書きする事故を防ぐ）
  if (loadError) {
    return (
      <div className="bg-white rounded-xl p-6 mt-6">
        <h3 className="text-sm font-bold text-gray-800 mb-4">キャンセルポリシー</h3>
        <LoadError onRetry={retry} message="キャンセルポリシーの読み込みに失敗しました" />
      </div>
    );
  }

  const selectedRule = ruleSelectValue(policy);
  const onlineCancelDisabled = selectedRule === 'no_online';

  return (
    <div className="bg-white rounded-xl p-6 mt-6">
      <h3 className="text-sm font-bold text-gray-800 mb-4">キャンセルポリシー</h3>
      <div className="space-y-4">
        <div>
          <label htmlFor="cancel-policy-free-hours" className="text-xs text-gray-600 block mb-1">キャンセルの受け付けと無料期限</label>
          <select
            id="cancel-policy-free-hours"
            value={selectedRule}
            onChange={(e) => {
              const value = e.target.value;
              setPolicy(value === 'always_fee' || value === 'no_online'
                ? { ...policy, cancel_rule: value }
                : { ...policy, cancel_rule: 'free_window', free_cancel_hours: Number(value) });
            }}
            className="form-input text-sm w-full! sm:w-80!"
          >
            {FREE_WINDOW_HOURS.map((hours) => (
              <option key={hours} value={String(hours)}>予約日時の{hours}時間前まで無料</option>
            ))}
            <option value="always_fee">{RULE_OPTION_LABEL.always_fee}</option>
            <option value="no_online">{RULE_OPTION_LABEL.no_online}</option>
          </select>
          {onlineCancelDisabled && (
            <p className="text-xs text-gray-600 mt-1">お客様はマイページ・LINE からキャンセルできなくなり、店舗へ直接ご連絡いただくよう案内されます。</p>
          )}
        </div>
        <div>
          <label htmlFor="cancel-policy-late-rate" className="text-xs text-gray-600 block mb-1">キャンセル料（施術料金の%）</label>
          <select
            id="cancel-policy-late-rate"
            value={policy.late_cancel_rate}
            onChange={(e) => setPolicy({ ...policy, late_cancel_rate: Number(e.target.value) })}
            disabled={onlineCancelDisabled}
            aria-describedby={onlineCancelDisabled ? 'cancel-policy-late-rate-note' : undefined}
            className="form-input text-sm w-48! disabled:bg-gray-100"
          >
            <option value={0}>0%（無料）</option>
            <option value={30}>30%</option>
            <option value={50}>50%</option>
            <option value={80}>80%</option>
            <option value={100}>100%（全額）</option>
          </select>
          {onlineCancelDisabled && (
            <p id="cancel-policy-late-rate-note" className="text-xs text-gray-600 mt-1">ネットでのキャンセルを受け付けない設定では、この料率はお客様に表示されません。キャンセル料の扱いは「ポリシー補足」でご案内ください。</p>
          )}
        </div>
        <div>
          <label htmlFor="cancel-policy-noshow-rate" className="text-xs text-gray-600 block mb-1">無断キャンセル料（施術料金の%）</label>
          <select
            id="cancel-policy-noshow-rate"
            value={policy.no_show_rate}
            onChange={(e) => setPolicy({ ...policy, no_show_rate: Number(e.target.value) })}
            className="form-input text-sm w-48!"
          >
            <option value={50}>50%</option>
            <option value={80}>80%</option>
            <option value={100}>100%（全額）</option>
          </select>
        </div>
        <div>
          <label htmlFor="cancel-policy-text" className="text-xs text-gray-600 block mb-1">ポリシー補足（お客様に表示されます）</label>
          <textarea
            id="cancel-policy-text"
            value={policy.policy_text}
            onChange={(e) => setPolicy({ ...policy, policy_text: e.target.value })}
            className="form-input text-sm"
            rows={3}
            placeholder="例: 当日キャンセルの場合、施術料金の50%をキャンセル料としていただきます。"
            maxLength={500}
          />
        </div>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary py-2! text-sm">
          {saving ? '保存中...' : saved ? '保存しました' : 'ポリシーを保存'}
        </button>
        {saveError && (
          <p className="text-xs text-red-600 mt-2" role="alert">保存に失敗しました。時間をおいて再度お試しください。</p>
        )}
      </div>
    </div>
  );
}
