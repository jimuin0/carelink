'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface SymptomMatch {
  id: string;
  name: string;
  slug: string;
  category: string;
  facilityCount: number;
}

const BODY_PARTS = [
  { label: '頭・首', symptoms: ['頭痛', '首の痛み', 'めまい', '眼精疲労'] },
  { label: '肩・背中', symptoms: ['肩こり', '五十肩'] },
  { label: '腰・お尻', symptoms: ['腰痛', 'ぎっくり腰', '椎間板ヘルニア', '坐骨神経痛'] },
  { label: '膝・脚', symptoms: ['膝痛', '捻挫'] },
  { label: '全身', symptoms: ['疲労回復', 'ストレス', '不眠症', '自律神経失調症', 'むくみ', '冷え性'] },
  { label: '女性特有', symptoms: ['生理痛', '更年期障害', '不妊', '産後の骨盤矯正'] },
  { label: 'スポーツ・事故', symptoms: ['スポーツ障害', '交通事故', 'むちうち', '骨折後のリハビリ'] },
  { label: 'その他', symptoms: ['花粉症', 'アレルギー', '胃腸の不調', '顔面神経麻痺'] },
];

export default function SymptomCheckerPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<SymptomMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const toggleSymptom = (s: string) => {
    setSelected(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSearch = async () => {
    if (selected.length === 0) return;
    setSearching(true);

    const { data: symptoms } = await supabase
      .from('symptoms')
      .select('id, name, slug, category')
      .in('name', selected);

    if (symptoms) {
      const withCounts = await Promise.all(
        symptoms.map(async (s) => {
          const { count } = await supabase
            .from('facility_symptoms')
            .select('id', { count: 'exact', head: true })
            .eq('symptom_id', s.id);
          return { ...s, facilityCount: count ?? 0 };
        })
      );
      setResults(withCounts.sort((a, b) => b.facilityCount - a.facilityCount));
    }

    setSearching(false);
    setSearched(true);
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-3">症状チェッカー</h1>
        <p className="text-sm text-gray-500 text-center mb-8">お悩みの症状を選択すると、対応できる店舗が見つかります</p>

        <div className="space-y-6 mb-8">
          {BODY_PARTS.map((part) => (
            <div key={part.label}>
              <h2 className="text-sm font-bold text-gray-700 mb-2">{part.label}</h2>
              <div className="flex flex-wrap gap-2">
                {part.symptoms.map((s) => {
                  const isSelected = selected.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSymptom(s)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                        isSelected
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSearch}
          disabled={selected.length === 0 || searching}
          className="w-full py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-colors disabled:bg-gray-300"
        >
          {searching ? '検索中...' : `${selected.length}件の症状で店舗を探す`}
        </button>

        {searched && (
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4">対応可能な症状</h2>
            {results.length > 0 ? (
              <div className="space-y-3">
                {results.map((r) => (
                  <Link
                    key={r.id}
                    href={`/symptom/${r.slug}`}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-emerald-50 transition-colors"
                  >
                    <div>
                      <p className="font-bold text-sm">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-emerald-600 font-bold">{r.facilityCount}件</p>
                      <p className="text-xs text-gray-400">対応店舗</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 bg-gray-50 rounded-xl">
                <p className="text-gray-500 text-sm">現在、対応可能な店舗が登録されていません</p>
                <Link href="/search" className="text-sky-600 text-sm mt-2 inline-block hover:underline">全店舗を検索 →</Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
