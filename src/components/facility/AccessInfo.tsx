import type { Facility } from '@/types';
import { dayOrder, dayLabels } from '@/lib/constants';

export default function AccessInfo({ facility }: { facility: Facility }) {
  const fullAddress = `${facility.prefecture}${facility.city}${facility.address}${facility.building ? ` ${facility.building}` : ''}`;

  return (
    <div className="space-y-8">
      {/* 基本情報 */}
      <div>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-sky-500 rounded-full" />
          基本情報
        </h3>
        <table className="w-full text-sm">
          <tbody>
            <InfoRow label="住所" value={fullAddress} />
            {facility.phone && <InfoRow label="電話番号" value={facility.phone} isPhone />}
            {facility.access_info && <InfoRow label="アクセス" value={facility.access_info} />}
            {facility.regular_holiday && <InfoRow label="定休日" value={facility.regular_holiday} />}
            {facility.seat_count && <InfoRow label="席数" value={`${facility.seat_count}席`} />}
            {facility.staff_count && <InfoRow label="スタッフ数" value={`${facility.staff_count}名`} />}
            {facility.parking && <InfoRow label="駐車場" value="あり" />}
            {facility.credit_card && <InfoRow label="クレジットカード" value="利用可" />}
            {facility.website_url && (
              <InfoRow
                label="Webサイト"
                value={
                  <a href={facility.website_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline break-all">
                    {facility.website_url}
                  </a>
                }
              />
            )}
          </tbody>
        </table>
      </div>

      {/* 営業時間 */}
      {facility.business_hours && (
        <div>
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            営業時間
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {dayOrder.map((day) => {
                const hours = facility.business_hours?.[day];
                return (
                  <tr key={day} className="border-b border-gray-100">
                    <td className="py-2.5 pr-4 text-gray-500 w-16 font-medium">{dayLabels[day]}</td>
                    <td className="py-2.5">
                      {hours ? `${hours.open} 〜 ${hours.close}` : <span className="text-gray-400">休み</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 特徴タグ */}
      {facility.features && facility.features.length > 0 && (
        <div>
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            特徴・設備
          </h3>
          <div className="flex flex-wrap gap-2">
            {facility.features.map((feature) => (
              <span key={feature} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full">
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Google Maps */}
      {facility.latitude && facility.longitude && (
        <div>
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="w-1 h-5 bg-sky-500 rounded-full" />
            地図
          </h3>
          <div className="rounded-xl overflow-hidden border border-gray-200">
            <iframe
              src={`https://maps.google.com/maps?q=${facility.latitude},${facility.longitude}&z=16&output=embed`}
              width="100%"
              height="300"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={`${facility.name}の地図`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, isPhone }: { label: string; value: React.ReactNode; isPhone?: boolean }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2.5 pr-4 text-gray-500 w-28 align-top font-medium">{label}</td>
      <td className="py-2.5">
        {isPhone ? (
          <a href={`tel:${value}`} className="text-sky-600 hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </td>
    </tr>
  );
}
