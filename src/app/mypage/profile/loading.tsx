export default function Loading() {
  return (
    <div className="animate-pulse py-6">
      <div className="h-6 bg-gray-200 rounded w-28 mb-6" />
      <div className="bg-white rounded-2xl p-6 space-y-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 bg-gray-100 rounded w-20" />
            <div className="h-10 bg-gray-100 rounded" />
          </div>
        ))}
        <div className="h-10 bg-gray-200 rounded w-32 mt-4" />
      </div>
    </div>
  );
}
