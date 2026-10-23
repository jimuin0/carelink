/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act, fireEvent, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
import { SALON_BROWSER_CONTEXT_KEY } from '@/lib/salon-browser-context';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

/**
 * 低速回線では SSR の HTML が届いてから JavaScript が動き出すまで数十秒かかる（実測 約27秒）。
 * 以前はその間ずっと入力欄が無効で、画面は見えているのに何も打てなかった。
 * 入力欄は SSR の時点から使え、送信（「次へ」）だけが準備完了まで止まる。動き出す前に打った値は消えない。
 */
async function hydrated(prepare: (view: ReturnType<typeof within>) => void, v2Enabled?: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToString(<RegisterForm v2Enabled={v2Enabled} />);
  const view = within(container);
  prepare(view);
  let root: Root | undefined;
  await act(async () => { root = hydrateRoot(container, <RegisterForm v2Enabled={v2Enabled} />); });
  return { view, cleanup: async () => { await act(async () => { root?.unmount(); }); container.remove(); } };
}

afterEach(() => { window.sessionStorage.clear(); });

test('SSRの時点で入力欄は使え、「次へ」だけが準備完了まで止まって理由を示す', async () => {
  const { view, cleanup } = await hydrated(view => {
    expect(view.getByLabelText(/^店舗名/)).toBeEnabled();
    expect(view.getByLabelText(/^業種/)).toBeEnabled();
    expect(view.getByLabelText(/^メールアドレス/)).toBeEnabled();
    const next = view.getByRole('button', { name: '次へ' });
    expect(next).toBeDisabled();
    const status = view.getByRole('status');
    expect(status).toHaveTextContent('入力はそのまま続けられます');
    expect(status).toHaveTextContent('JavaScript');
    expect(next).toHaveAttribute('aria-describedby', status.id);
    // 3 ページ目は hidden のまま常に描かれる。案内は表示中のページにだけ出し、id を重複させない。
    expect(document.querySelectorAll(`#${status.id}`)).toHaveLength(1);
    // フォームの中に別のフォーム（旧「ページを再読み込み」）を入れ子にしない。
    expect(view.getByLabelText(/^店舗名/).closest('form')?.querySelector('form')).toBeNull();
  });
  try {
    expect(view.getByRole('button', { name: '次へ' })).toBeEnabled();
    expect(view.getByRole('button', { name: '次へ' })).not.toHaveAttribute('aria-describedby');
    expect(view.queryByRole('status')).not.toBeInTheDocument();
  } finally { await cleanup(); }
});

test('JavaScriptが動き出す前に打った値は、react-hook-form の初期化で消えず、そのまま送信まで使われる', async () => {
  const { view, cleanup } = await hydrated(view => {
    // hydration 前は React のハンドラが無いので、DOM の値を直接書き換える（＝利用者が打った状態）。
    (view.getByLabelText(/^店舗名/) as HTMLInputElement).value = '先に打った店舗';
    (view.getByLabelText(/^業種/) as HTMLSelectElement).value = 'ヘアサロン';
    (view.getByLabelText(/^代表者名/) as HTMLInputElement).value = '代表 太郎';
    (view.getByLabelText(/^メールアドレス/) as HTMLInputElement).value = 'fixture@example.invalid';
    (view.getByLabelText(/^電話番号/) as HTMLInputElement).value = '09012345678';
  });
  try {
    expect(view.getByLabelText(/^店舗名/)).toHaveValue('先に打った店舗');
    expect(view.getByLabelText(/^業種/)).toHaveValue('ヘアサロン');
    // 動き出す前の入力も、ページを離れるときの確認の対象になる。
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    // 値は RHF にも渡っている：検証を通って 2 ページ目へ進み、戻っても残る。
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    await view.findByLabelText(/^郵便番号/);
    fireEvent.click(view.getByRole('button', { name: '戻る' }));
    expect(view.getByLabelText(/^店舗名/)).toHaveValue('先に打った店舗');
    expect(view.getByLabelText(/^代表者名/)).toHaveValue('代表 太郎');
    // 「担当者も代表者と同じ」の追従も、引き継いだ代表者名で動いている（担当者名の不備で止まらない）。
    expect(document.querySelector('.form-error')).toBeNull();
    // 外して付け直しても、担当者名は引き継いだ代表者名に追従し直す（空で上書きしない）。
    const same = view.getByRole('checkbox', { name: '担当者も代表者と同じ' });
    fireEvent.click(same); fireEvent.click(same);
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    await view.findByLabelText(/^郵便番号/);
  } finally { await cleanup(); }
});

test('動き出す前に何も打っていなければ、従来どおり空欄から始まり最初の入力も失わない', async () => {
  const { view, cleanup } = await hydrated(() => {});
  try {
    expect(view.getByLabelText(/^店舗名/)).toHaveValue('');
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    fireEvent.change(view.getByLabelText(/^店舗名/), { target: { value: '初回入力施設' } });
    fireEvent.change(view.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
    fireEvent.change(view.getByLabelText(/^代表者名/), { target: { value: '代表 太郎' } });
    fireEvent.change(view.getByLabelText(/^メールアドレス/), { target: { value: 'fixture@example.invalid' } });
    fireEvent.change(view.getByLabelText(/^電話番号/), { target: { value: '09012345678' } });
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    await view.findByLabelText(/^郵便番号/);
    fireEvent.click(view.getByRole('button', { name: '戻る' }));
    expect(view.getByLabelText(/^店舗名/)).toHaveValue('初回入力施設');
  } finally { await cleanup(); }
});

test('既存の申込の受付確認が終わるまでは最後の送信だけを止め、入力と「次へ」は続けられる', async () => {
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId: '74000000-0000-4000-8000-000000000001', phase: 'prepared' }));
  let finish!: (value: unknown) => void;
  const fetchMock = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const original = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  const { view, cleanup } = await hydrated(() => {}, true);
  try {
    expect(fetchMock).toHaveBeenCalledWith('/api/salons/status', expect.anything());
    expect(view.getByRole('status')).toHaveTextContent('送信の準備をしています');
    for (const [label, value] of [[/^店舗名/, '確認中に入力'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '代表 太郎'],
      [/^メールアドレス/, 'fixture@example.invalid'], [/^電話番号/, '09012345678']] as const) {
      fireEvent.change(view.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    await view.findByLabelText(/^郵便番号/);
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    const submit = await view.findByRole('button', { name: '登録する' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-describedby', view.getByRole('status').id);
    // Enter キー等でのフォーム送信も止まる（確認ダイアログを開かない）。
    fireEvent.submit(submit.closest('form')!);
    expect(view.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { finish({ status: 200, ok: true, json: async () => ({ state: 'uncommitted' }) }); });
    expect(view.getByRole('button', { name: '登録する' })).toBeEnabled();
    expect(view.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: '戻る' }));
    fireEvent.click(view.getByRole('button', { name: '戻る' }));
    expect(view.getByLabelText(/^店舗名/)).toHaveValue('確認中に入力');
  } finally { global.fetch = original; await cleanup(); }
});
