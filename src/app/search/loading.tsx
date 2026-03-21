export default function SearchLoading() {
  return (
    <div className="section-container">
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 animate-pulse">
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2 h-12 bg-gray-200 rounded-lg" />
          <div className="h-12 bg-gray-200 rounded-lg" />
          <div className="h-12 bg-gray-200 rounded-lg" />
        </div>
        <div className="h-12 bg-gray-200 rounded-lg mt-3" />
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-md overflow-hidden animate-pulse">
            <div className="aspect-[16/10] bg-gray-200" />
            <div className="p-4 space-y-3">
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-200 rounded w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
