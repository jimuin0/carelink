import { getUserFavorites } from '@/lib/user';
import FacilityCard from '@/components/search/FacilityCard';

export default async function FavoritesPage() {
  const favorites = await getUserFavorites();

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">お気に入り施設</h1>

      {favorites.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <p className="text-gray-500 mb-2">お気に入りがありません</p>
          <p className="text-sm text-gray-400">施設ページでハートマークをタップして追加しましょう</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {favorites.map((fav) => (
            <FacilityCard key={fav.id} facility={fav.facility} />
          ))}
        </div>
      )}
    </div>
  );
}
