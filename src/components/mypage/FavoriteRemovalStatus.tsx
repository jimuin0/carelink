'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** 外し終えたときに呼ぶ。ページ側の常設ライブリージョンへお知らせを書き、フォーカスを見出しへ移す。 */
type AnnounceRemoved = () => void;

const FavoriteRemovalContext = createContext<AnnounceRemoved | null>(null);

export const FAVORITE_REMOVED_MESSAGE = 'お気に入りから外しました。';

/**
 * マイページ「お気に入り施設」で、外した結果を支援技術の利用者にも伝えるための器。
 *
 * 外すとボタンが消え、直後の router.refresh() でカードごと一覧から消える。カードの中で
 * お知らせを出すと（1）フォーカスが body に戻り（2）お知らせ自体もカードと一緒に消える。
 * そこでお知らせは、カードより外に最初から空で置いてあるライブリージョンに書き、
 * フォーカスはカードの外にある見出し（headingId）へ移す。この器は refresh の前後で同じ位置に
 * 描画されるので、お知らせは読み直したあとも残る。
 */
export function FavoriteRemovalStatusProvider({ headingId, children }: { headingId: string; children: ReactNode }) {
  const [message, setMessage] = useState('');
  const announce = useCallback(() => {
    // 2 件目以降も読み上げさせるため、いったん空にしてから書き直す（同じ文のままだと変化として伝わらない）。
    setMessage('');
    requestAnimationFrame(() => setMessage(FAVORITE_REMOVED_MESSAGE));
    document.getElementById(headingId)?.focus();
  }, [headingId]);

  return (
    <FavoriteRemovalContext.Provider value={announce}>
      <p role="status" className={message ? 'mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700' : 'sr-only'}>
        {message}
      </p>
      {children}
    </FavoriteRemovalContext.Provider>
  );
}

/** 器の中なら announce を返す。器の外（単体で使われた場合）は null。 */
export function useAnnounceFavoriteRemoved(): AnnounceRemoved | null {
  return useContext(FavoriteRemovalContext);
}
