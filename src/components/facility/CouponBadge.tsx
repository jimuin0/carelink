const badgeStyles: Record<string, { bg: string; text: string; label: string }> = {
  new_customer: { bg: 'bg-green-50', text: 'text-green-700', label: '新規' },
  repeat: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'リピーター' },
  limited_time: { bg: 'bg-red-50', text: 'text-red-700', label: '期間限定' },
  all: { bg: 'bg-gray-50', text: 'text-gray-700', label: '全員' },
};

export default function CouponBadge({ type }: { type: string }) {
  const style = badgeStyles[type] ?? badgeStyles.all;
  return (
    <span className={`text-micro font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}
