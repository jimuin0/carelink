'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';

type Estimator = (password: string) => number;

export default function PasswordStrengthMeter({ password }: { password: string }) {
  const [estimate, setEstimate] = useState<Estimator | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const deferredPassword = useDeferredValue(password);
  const hasPassword = password.length > 0;

  useEffect(() => {
    if (!hasPassword) return;
    let active = true;
    void import('@/lib/password-strength').then(module => {
      const estimatePassword = module.estimatePasswordStrength;
      if (active) {
        setEstimate(() => estimatePassword);
        setUnavailable(false);
      }
    }).catch(() => {
      // A failed optional meter must never block account creation.
      if (active) setUnavailable(true);
    });
    return () => { active = false; };
  }, [hasPassword]);

  const score = useMemo(
    () => estimate && deferredPassword ? estimate(deferredPassword) : null,
    [estimate, deferredPassword],
  );
  const pending = hasPassword && (score === null || deferredPassword !== password);
  const level = !hasPassword || unavailable || pending ? 0 : score! <= 1 ? 1 : score === 2 ? 2 : 3;
  const label = !hasPassword ? '未入力' : unavailable ? '判定できません' : pending ? '判定中…' : level === 1 ? '低い' : level === 2 ? '中程度' : '高い';
  const color = level === 1 ? 'bg-red-500' : level === 2 ? 'bg-amber-500' : 'bg-emerald-600';

  return (
    <div id="signup-password-strength" className="mt-2">
      <div className="mb-1.5 flex items-center justify-between text-xs text-gray-600" aria-live="polite" aria-atomic="true">
        <span>安全性の目安</span>
        <span className="font-medium text-gray-700">{label}</span>
      </div>
      <div role="meter" aria-label="パスワードの安全性の目安" aria-valuemin={0} aria-valuemax={3} aria-valuenow={level} aria-valuetext={label} className="flex gap-1.5">
        {[1, 2, 3].map(segment => <span key={segment} aria-hidden="true" className={`h-1.5 flex-1 rounded-full ${segment <= level ? color : 'bg-gray-200'}`} />)}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-gray-500">流出の有無は登録時に確認します。</p>
    </div>
  );
}
