export default function SettingsLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-1/4" />
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-6 space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/5" />
          <div className="h-10 bg-gray-200 rounded" />
          <div className="h-10 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}
