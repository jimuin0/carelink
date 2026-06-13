export default function ScheduleLoading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="読み込み中">
      <div className="h-7 bg-gray-200 rounded w-40" />
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="h-9 bg-gray-100 border-b" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex border-b last:border-b-0">
            <div className="w-36 shrink-0 h-14 border-r bg-gray-50" />
            <div className="flex-1 h-14 bg-white" />
          </div>
        ))}
      </div>
    </div>
  );
}
