'use client';

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const Japan = dynamic(() => import('@react-map/japan'), { ssr: false });

const prefectureMap: Record<string, string> = {
  Hokkaido: '北海道', Aomori: '青森県', Iwate: '岩手県', Miyagi: '宮城県',
  Akita: '秋田県', Yamagata: '山形県', Fukushima: '福島県',
  Ibaraki: '茨城県', Tochigi: '栃木県', Gunma: '群馬県', Saitama: '埼玉県',
  Chiba: '千葉県', Tokyo: '東京都', Kanagawa: '神奈川県',
  Niigata: '新潟県', Toyama: '富山県', Ishikawa: '石川県', Fukui: '福井県',
  Yamanashi: '山梨県', Nagano: '長野県', Gifu: '岐阜県', Shizuoka: '静岡県',
  Aichi: '愛知県', Mie: '三重県', Shiga: '滋賀県', Kyoto: '京都府',
  Osaka: '大阪府', Hyogo: '兵庫県', Nara: '奈良県', Wakayama: '和歌山県',
  Tottori: '鳥取県', Shimane: '島根県', Okayama: '岡山県', Hiroshima: '広島県',
  Yamaguchi: '山口県', Tokushima: '徳島県', Kagawa: '香川県', Ehime: '愛媛県',
  Kochi: '高知県', Fukuoka: '福岡県', Saga: '佐賀県', Nagasaki: '長崎県',
  Kumamoto: '熊本県', Oita: '大分県', Miyazaki: '宮崎県', Kagoshima: '鹿児島県',
  Okinawa: '沖縄県',
};

// Hokkaido has a special character in the package's stateCode
const normalize = (code: string) => code.replace(/[^\x20-\x7E]/g, '');

export default function JapanRegionMap() {
  const router = useRouter();

  const handleSelect = (state: string | null) => {
    if (!state) return;
    const clean = normalize(state);
    const jp = prefectureMap[clean];
    if (jp) {
      router.push(`/search?area=${encodeURIComponent(jp)}`);
    }
  };

  return (
    <div className="flex justify-center">
      <Japan
        type="select-single"
        size={280}
        mapColor="#e0f2fe"
        strokeColor="#7dd3fc"
        strokeWidth={0.3}
        hoverColor="#38bdf8"
        selectColor="#0ea5e9"
        hints
        hintTextColor="#1e3a5f"
        hintBackgroundColor="#f0f9ff"
        hintBorderRadius={6}
        onSelect={handleSelect}
      />
    </div>
  );
}
