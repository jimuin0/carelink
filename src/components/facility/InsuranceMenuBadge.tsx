export default function InsuranceMenuBadge({ insurancePrice }: { insurancePrice?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
      保険適用
      {insurancePrice != null && <span className="text-emerald-600">（自己負担 ¥{insurancePrice.toLocaleString()}）</span>}
    </span>
  );
}
