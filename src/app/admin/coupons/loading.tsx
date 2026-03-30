export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="flex justify-between items-center mb-6">
        <div className="h-7 bg-gray-200 rounded w-28" />
        <div className="h-9 bg-gray-200 rounded w-28" />
      </div>
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <div className="h-5 bg-gray-200 rounded w-2/3" />
              <div className="h-6 w-14 bg-gray-100 rounded-full" />
            </div>
            <div className="h-4 bg-gray-100 rounded w-1/2 mb-1" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
