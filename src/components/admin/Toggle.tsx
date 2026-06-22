'use client';

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** aria-label（ラベルを視覚的に別要素で持たない場合に指定） */
  label?: string;
}

/**
 * ON/OFF スイッチの共通部品（role=switch / aria-checked）。
 * 各所で直書きされていた同一マークアップを一元化し、a11y 属性を統一する。
 */
export default function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${checked ? 'bg-sky-500' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}
