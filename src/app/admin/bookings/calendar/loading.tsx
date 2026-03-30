export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-36" />
        <div className="flex gap-2">
          <div className="h-9 w-9 bg-gray-200 rounded" />
          <div className="h-9 w-24 bg-gray-200 rounded" />
          <div className="h-9 w-9 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="bg-white rounded-xl p-4">
        <div className="grid grid-cols-7 gap-1">
          {[...Array(35)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-50 rounded border border-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
