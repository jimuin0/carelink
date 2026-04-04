interface Certification {
  id: string;
  certification_name: string;
  license_number?: string | null;
  staff_name?: string | null;
}

export default function CertificationList({ certifications }: { certifications: Certification[] }) {
  if (certifications.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-emerald-500">保有資格・認定</h3>
      <div className="grid gap-2">
        {certifications.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">{c.certification_name}</p>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                {c.staff_name && <span>{c.staff_name}</span>}
                {c.license_number && <span>No. {c.license_number}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
