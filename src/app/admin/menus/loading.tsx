export default function MenusLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        <div className="h-10 bg-gray-200 rounded w-28" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-4 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-16 bg-gray-200 rounded" />
          <div className="h-16 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}
