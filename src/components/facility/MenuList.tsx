import type { FacilityMenu } from '@/types';

function formatPrice(price: number | null, note: string | null) {
  if (note) return note;
  if (price === null) return '-';
  return `¥${price.toLocaleString()}`;
}

function formatDuration(minutes: number | null) {
  if (!minutes) return null;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  }
  return `${minutes}分`;
}

export default function MenuList({ menus }: { menus: FacilityMenu[] }) {
  if (menus.length === 0) {
    return <p className="text-gray-400 text-center py-8">メニュー情報はまだ登録されていません。</p>;
  }

  // Group by category
  const categories: Record<string, FacilityMenu[]> = {};
  for (const menu of menus) {
    if (!categories[menu.category]) categories[menu.category] = [];
    categories[menu.category].push(menu);
  }

  return (
    <div className="space-y-8">
      {Object.entries(categories).map(([category, items]) => (
        <div key={category}>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            {category}
          </h3>
          <div className="space-y-3">
            {items.map((menu) => (
              <div
                key={menu.id}
                className="flex items-start justify-between p-4 bg-gray-50 rounded-xl"
              >
                <div className="flex-1 mr-4">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm">{menu.name}</p>
                    {menu.is_featured && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        おすすめ
                      </span>
                    )}
                  </div>
                  {menu.description && (
                    <p className="text-gray-500 text-xs mt-1">{menu.description}</p>
                  )}
                  {formatDuration(menu.duration_minutes) && (
                    <p className="text-gray-400 text-xs mt-1">
                      所要時間: {formatDuration(menu.duration_minutes)}
                    </p>
                  )}
                </div>
                <p className="text-right font-bold text-sm whitespace-nowrap" style={{ color: 'var(--primary)' }}>
                  {formatPrice(menu.price, menu.price_note)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
