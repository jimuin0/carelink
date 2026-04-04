import Link from 'next/link';

interface Symptom {
  symptom_id: string;
  description?: string | null;
  symptoms: { name: string; slug: string; category: string };
}

export default function SymptomList({ symptoms }: { symptoms: Symptom[] }) {
  if (symptoms.length === 0) return null;

  // カテゴリ別にグルーピング
  const grouped = symptoms.reduce<Record<string, Symptom[]>>((acc, s) => {
    const cat = s.symptoms.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-gray-800 pl-3 border-l-[3px] border-emerald-500">対応症状</h3>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h4 className="text-xs font-bold text-gray-500 mb-2">{category}</h4>
          <div className="flex flex-wrap gap-2">
            {items.map((s) => (
              <Link
                key={s.symptom_id}
                href={`/symptom/${s.symptoms.slug}`}
                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs hover:bg-emerald-100 transition-colors"
              >
                {s.symptoms.name}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
