export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-7 bg-gray-200 rounded w-28 mb-6" />
      <div className="bg-white rounded-xl overflow-hidden">
        <div className="h-10 bg-gray-100" />
        <div className="divide-y">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-100 rounded w-40 flex-1" />
              <div className="h-4 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
