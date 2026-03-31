export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-32" />
        <div className="h-9 bg-gray-200 rounded w-20" />
      </div>
      <div className="bg-white rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-gray-200" />
          <div className="space-y-2">
            <div className="h-5 bg-gray-200 rounded w-32" />
            <div className="h-4 bg-gray-100 rounded w-24" />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 bg-gray-100 rounded w-24" />
            <div className="h-10 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
