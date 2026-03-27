export default function PhotosLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-1/4" />
      <div className="bg-white rounded-xl p-6 space-y-3">
        <div className="h-6 bg-gray-200 rounded w-1/5" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <div key={i} className="aspect-square bg-gray-200 rounded-xl" />)}
      </div>
    </div>
  );
}
