/**
 * first-frame ヘルパ自身の検査（正・負の対照）。
 *
 * この 2 本が無いと、ヘルパが壊れて【何を渡しても緑】になったことに気づけない。
 * - 負の対照: effect のトップレベルで setState する実装は、最初のフレームに間に合わない。
 * - 正の対照: イベントハンドラ側で setState する実装は、最初のフレームから反映される。
 * 実際のコンポーネントを検査する前に、この差を検出できることを機械で示す。
 */
import { useEffect, useState } from 'react';
import { clickFirstFrame, mountFirstFrame } from '../first-frame';

const LOADING = '読み込み中';
const EMPTY = '該当なし';

/**
 * 欠陥のある形：押した瞬間は前の状態（＝「該当なし」）が見える。
 *
 * ⚠️ この部品は【意図的に欠陥を残してある】。react-hooks/set-state-in-effect は
 * eslint.config.mjs でこのファイルにだけ off にしてある（理由はそちらのコメント）。
 * 製品コードでこの形を書いてはいけない。
 */
function EffectDriven() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
  }, [open]);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        開く
      </button>
      {open && <p>{loading ? LOADING : EMPTY}</p>}
    </div>
  );
}

/** 正しい形：setOpen と同じ更新にまとまるので最初のフレームから読み込み中。 */
function HandlerDriven() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setLoading(true);
        }}
      >
        開く
      </button>
      {open && <p>{loading ? LOADING : EMPTY}</p>}
    </div>
  );
}

describe('first-frame ヘルパ', () => {
  it('負の対照: effect 起点の setState は最初のフレームに間に合わない', async () => {
    const handle = mountFirstFrame(<EffectDriven />);
    const button = handle.container.querySelector('button');
    expect(button).not.toBeNull();

    clickFirstFrame(button as Element);

    // 押した最初のフレーム。まだ何も試していないのに「該当なし」が見えている＝これが実欠陥。
    expect(handle.text()).toContain(EMPTY);
    expect(handle.text()).not.toContain(LOADING);

    // 次のコミットでようやく読み込み中へ変わる（＝1 フレーム誤情報が見えていた証拠）。
    await handle.settle();
    expect(handle.text()).toContain(LOADING);

    handle.unmount();
  });

  it('正の対照: ハンドラ起点の setState は最初のフレームから反映される', async () => {
    const handle = mountFirstFrame(<HandlerDriven />);
    const button = handle.container.querySelector('button');
    expect(button).not.toBeNull();

    clickFirstFrame(button as Element);

    expect(handle.text()).toContain(LOADING);
    expect(handle.text()).not.toContain(EMPTY);

    handle.unmount();
  });

  it('マウント直後の最初のフレームも観測できる（エフェクト適用前）', async () => {
    function MountDriven() {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        setReady(true);
      }, []);
      return <p>{ready ? '準備完了' : '準備中'}</p>;
    }

    const handle = mountFirstFrame(<MountDriven />);
    expect(handle.text()).toBe('準備中');

    await handle.settle();
    expect(handle.text()).toBe('準備完了');

    handle.unmount();
  });
});
