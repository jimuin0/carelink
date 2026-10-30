'use client';

import { medicalSpecialties } from '@/lib/medical-specialties';

type Props = {
  value: readonly string[];
  onChange: (value: string[]) => void;
};

/** 選択順を固定して保存内容の比較と再送を安定させる。 */
export default function MedicalSpecialtyPicker({ value, onChange }: Props) {
  return (
    <fieldset className="space-y-2">
      <legend className="form-label">診療科（複数選択可）</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {medicalSpecialties.map(specialty => (
          <label key={specialty} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-(--ecru-accent)" checked={value.includes(specialty)}
              onChange={event => {
                const next = new Set(value);
                if (event.target.checked) next.add(specialty);
                else next.delete(specialty);
                onChange(medicalSpecialties.filter(item => next.has(item)));
              }} />
            {specialty}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
