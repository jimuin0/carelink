'use client';

export default function FacilitySelector({ memberships, currentFacilityId }: {
  memberships: { facility_id: string; name: string }[];
  currentFacilityId: string;
}) {
  return (
    <select
      defaultValue={currentFacilityId}
      onChange={(e) => { window.location.href = `/admin?facility=${e.target.value}`; }}
      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600"
    >
      {memberships.map((m) => (
        <option key={m.facility_id} value={m.facility_id}>
          {m.name || m.facility_id}
        </option>
      ))}
    </select>
  );
}
