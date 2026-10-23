/**
 * 施設ページ下部の「似たサロン」と「〇〇市の他のサロン」で同じ店を重ねて出さない（2026年10月23日）。
 */
import { getNearbyForFacilityPage, getSimilarForFacilityPage, RELATED_FACILITIES_LIMIT } from '../related-facilities';
import { getNearbyFacilities, getSimilarFacilities } from '../facilities';

jest.mock('../facilities', () => ({ getSimilarFacilities: jest.fn(), getNearbyFacilities: jest.fn() }));

const card = (id: string) => ({ id, name: id });

beforeEach(() => jest.clearAllMocks());

test('似たサロンは上限件数で読む', async () => {
  (getSimilarFacilities as jest.Mock).mockResolvedValue([card('a')]);
  await expect(getSimilarForFacilityPage('self', 'ネイル', '大阪府')).resolves.toEqual([card('a')]);
  expect(getSimilarFacilities).toHaveBeenCalledWith('self', 'ネイル', '大阪府', RELATED_FACILITIES_LIMIT);
});

test('近くのサロンから、似たサロンに出した店を除く', async () => {
  (getSimilarFacilities as jest.Mock).mockResolvedValue([card('a'), card('b')]);
  (getNearbyFacilities as jest.Mock).mockResolvedValue([card('b'), card('c'), card('a'), card('d')]);
  const result = await getNearbyForFacilityPage('self', 'ネイル', '大阪府', '豊中市');
  expect(result.map((f) => f.id)).toEqual(['c', 'd']);
  expect(getNearbyFacilities).toHaveBeenCalledWith('self', '大阪府', '豊中市', RELATED_FACILITIES_LIMIT * 2);
});

test('除いた分は多めに読んだ残りで埋め、上限件数に切り詰める', async () => {
  (getSimilarFacilities as jest.Mock).mockResolvedValue(['a', 'b', 'c', 'd'].map(card));
  (getNearbyFacilities as jest.Mock).mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(card));
  const result = await getNearbyForFacilityPage('self', 'ネイル', '大阪府', '豊中市');
  expect(result.map((f) => f.id)).toEqual(['e', 'f', 'g', 'h']);
  expect(result).toHaveLength(RELATED_FACILITIES_LIMIT);
});

test('重なりが無ければ近くのサロンを上限件数まで出す', async () => {
  (getSimilarFacilities as jest.Mock).mockResolvedValue([]);
  (getNearbyFacilities as jest.Mock).mockResolvedValue(['p', 'q', 'r', 's', 't'].map(card));
  const result = await getNearbyForFacilityPage('self', 'ネイル', '大阪府', '豊中市');
  expect(result.map((f) => f.id)).toEqual(['p', 'q', 'r', 's']);
});
