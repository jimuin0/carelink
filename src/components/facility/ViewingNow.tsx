'use client';

import { useState, useSyncExternalStore } from 'react';

// 購読対象の外部イベントが無い（Math.random() は呼ぶたびに新しい値を返すだけで、
// 変化を通知してくれる外部ソースが存在しない）ため、subscribe は no-op。
function subscribeNoop() {
  return () => {};
}

function getServerViewersSnapshot(): number | null {
  return null;
}

// viewCount が変わらない限り同じ乱数抽選結果を返すキャッシュを1つ作る（コンポーネント
// インスタンスごとに useState の遅延初期化で1回だけ生成）。useSyncExternalStore の
// getSnapshot は毎レンダー呼ばれるため、キャッシュ無しで直接 Math.random() すると
// viewCount が変わっていない再レンダーでも表示人数がちらつく（従来の
// useEffect(..., [viewCount]) は viewCount 変化時にしか再抽選しなかったため、これは
// 挙動の後退になる）。render 中に ref を書き込むと react-hooks/refs に検出されるため、
// useRef ではなくクロージャ変数でキャッシュする（React公式ドキュメントが
// useSyncExternalStore のスナップショットキャッシュ方法として案内している形）。
function createViewersSnapshotGetter() {
  let cachedViewCount: number | null = null;
  let cachedViewers = 0;
  return (currentViewCount: number) => {
    if (cachedViewCount !== currentViewCount) {
      cachedViewCount = currentViewCount;
      const randomOffset = Math.floor(Math.random() * 3) + 1;
      cachedViewers = Math.max(1, Math.floor(currentViewCount / 100) + randomOffset);
    }
    return cachedViewers;
  };
}

export default function ViewingNow({ viewCount }: { viewCount: number }) {
  // 「N人が閲覧中」は演出用に軽いランダム要素を持つ。Math.random() を描画中に評価すると
  // サーバ(SSR)とクライアントで値が食い違い hydration mismatch（サーバHTMLとクライアント描画の
  // テキスト不一致→Reactがツリーを再生成）を起こす。従来は useEffect + setState でマウント後
  // (クライアントのみ)に確定していたが、React Compiler の set-state-in-effect に検出されるため、
  // React公式が「サーバ/クライアントで異なる値を安全に出し分ける」ために用意している
  // useSyncExternalStore（getServerSnapshot 引数）に置き換える。
  const [getSnapshot] = useState(createViewersSnapshotGetter);
  const viewers = useSyncExternalStore(
    subscribeNoop,
    () => getSnapshot(viewCount),
    getServerViewersSnapshot,
  );

  if (viewers === null || viewers <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
      <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
      {viewers}人が閲覧中
    </span>
  );
}
