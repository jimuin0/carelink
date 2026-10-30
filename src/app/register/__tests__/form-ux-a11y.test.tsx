/** @jest-environment jsdom */
/**
 * /register 申込フォームの操作性・アクセシビリティの回帰テスト（2026年10月23日の監査対応）。
 * どれも旧実装では落ちる（＝直したことの証拠になる）形で書いている。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
import StepIndicator from '@/components/StepIndicator';
import { REGISTER_PHOTO_FIELD_NOTE } from '@/lib/register-photo-policy';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase-browser', () => { const client = { storage: { from: () => ({
  upload: jest.fn().mockResolvedValue({ error: null }), remove: jest.fn().mockResolvedValue({ error: null }),
  getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fixture.invalid/${path}` } }),
}) } }; return { createBrowserSupabaseClient: () => client }; });

const id = '11111111-1111-1111-1111-111111111111';
const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
let mockFetch: jest.Mock;
const scrollIntoView = jest.fn();

beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear();
  mockFetch = jest.fn().mockResolvedValue(jsonResponse(200, { success: true, id }));
  global.fetch = mockFetch;
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
  Element.prototype.scrollIntoView = scrollIntoView;
});

async function mount() {
  const view = render(<RegisterForm />);
  await waitFor(() => expect(screen.getByLabelText(/^店舗名/)).toBeEnabled());
  return view;
}
function fillStep1() {
  fireEvent.change(screen.getByLabelText(/^店舗名/), { target: { value: '合成施設' } });
  fireEvent.change(screen.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
  fireEvent.change(screen.getByLabelText(/^代表者名/), { target: { value: '合成代表' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'fixture@example.invalid' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '09012345678' } });
}
async function toStep3() {
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
}
async function submitAndReadPayload() {
  screen.getAllByRole('checkbox').forEach(box => { if (!(box as HTMLInputElement).checked) fireEvent.click(box); });
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '送信する' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  return JSON.parse(mockFetch.mock.calls.find(([url]) => url === '/api/salons')![1].body);
}

describe('下書き・バックアップ欄', () => {
  test('最初の入力欄より前には、閉じた 1 行の details だけを置く', async () => {
    await mount();
    const details = document.getElementById('register-draft-tools') as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')).toHaveTextContent('入力途中の内容を保存する（任意）');
    // 説明文と操作はすべて details の中に入っている。
    expect(details).toContainElement(screen.getByRole('button', { name: '端末の下書きを削除' }));
    expect(details).toContainElement(screen.getByRole('button', { name: '入力と元の写真をバックアップ' }));
    expect(details).toContainElement(screen.getByLabelText('バックアップから入力を復元'));
    // フォームより前に置いた要素は details だけ（ステップ表示を除く）。
    const form = document.querySelector('form:not([action])')!;
    expect(details.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('ブラウザー既定のファイル選択欄（Choose File）を見せず、日本語のボタンの裏に隠す', async () => {
    await mount();
    const input = screen.getByLabelText('バックアップから入力を復元');
    expect(input).toHaveClass('sr-only');
    expect(input.closest('label')).toHaveTextContent('バックアップから入力を復元');
  });

  test('操作は押せる大きさのボタンで、取り消せない「削除」だけ見た目を分ける', async () => {
    await mount();
    const remove = screen.getByRole('button', { name: '端末の下書きを削除' });
    const backup = screen.getByRole('button', { name: '入力と元の写真をバックアップ' });
    expect(remove.className).toMatch(/min-h-11/);
    expect(backup.className).toMatch(/min-h-11/);
    expect(remove.className).toMatch(/text-red-700/);
    expect(backup.className).not.toMatch(/text-red-700/);
    expect(remove.className).not.toMatch(/\bunderline\b/);
  });
});

describe('ステップの切り替え', () => {
  test('医療機関を選ぶと複数の診療科を選べ、次の画面から戻っても保持する', async () => {
    await mount(); fillStep1();
    const select = screen.getByLabelText(/^業種/) as HTMLSelectElement;
    expect(screen.queryByLabelText('耳鼻咽喉科')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'その他の医療機関' } });
    fireEvent.click(screen.getByLabelText('耳鼻咽喉科'));
    fireEvent.click(screen.getByLabelText('内科'));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByLabelText(/^郵便番号/);
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(await screen.findByLabelText(/^業種/)).toHaveValue('内科');
    expect(screen.getByLabelText('耳鼻咽喉科')).toBeChecked();
    expect(screen.getByLabelText('内科')).toBeChecked();
  });

  test('「次へ」「戻る」で現在のステップ表示へスクロールし、フォーカスを移す', async () => {
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByLabelText(/^郵便番号/);
    const status = screen.getByText('ステップ 2/3 詳細情報');
    await waitFor(() => expect(status).toHaveFocus());
    expect(status).toHaveAttribute('tabindex', '-1');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(status);
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    await waitFor(() => expect(screen.getByText('ステップ 1/3 基本情報')).toHaveFocus());
  });

  test('各ステップのボタンの高さをそろえる', async () => {
    // 高さは共通 Button の size（min-h-*）が持つ。どのステップのボタンも同じ高さの指定になっていること。
    const heightOf = (name: string) => screen.getByRole('button', { name }).className.split(/\s+/).filter((c) => c.startsWith('min-h-'));
    await mount(); fillStep1();
    const stepHeight = heightOf('次へ');
    expect(stepHeight).toHaveLength(1);
    await toStep3();
    expect(heightOf('登録する')).toEqual(stepHeight);
    expect(heightOf('戻る')).toEqual(stepHeight);
  });
});

describe('StepIndicator', () => {
  test('ol で描き、現在地に aria-current="step"、スマホでも「ステップ n/3 ラベル」を出す', () => {
    render(<StepIndicator currentStep={2} totalSteps={3} labels={['基本情報', '詳細情報', 'PR情報']} />);
    const list = screen.getByRole('list', { name: '入力の進み具合' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    const status = screen.getByText('ステップ 2/3 詳細情報');
    expect(status.className).not.toMatch(/(^|\s)(sm:)?(hidden|block)(\s|$)/);
    // 未到達の色は灰色の直書きではなく、テーマの変数（無ければ灰色へ倒す）を見る。
    expect(items[2].innerHTML).toMatch(/--ecru-muted/);
    expect(items[2].innerHTML).not.toMatch(/bg-gray-200 text-gray-500/);
  });
});

describe('入力エラー', () => {
  test('エラー文は欄と aria-describedby で結び、aria-invalid を付ける。role=alert は要約 1 つだけ', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    const name = screen.getByLabelText(/^店舗名/);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription('店舗名を入力してください');
    expect(screen.getByLabelText(/^電話番号/)).toHaveAccessibleDescription('正しい電話番号を入力してください');
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/入力内容を確認してください（\d+件）/);
    await waitFor(() => expect(name).toHaveFocus());
  });

  test('正しく入力された欄には aria-invalid を付けない', async () => {
    await mount(); fillStep1();
    fireEvent.blur(screen.getByLabelText(/^店舗名/));
    await waitFor(() => expect(screen.getByLabelText(/^店舗名/)).not.toHaveAttribute('aria-invalid'));
    expect(screen.getByLabelText(/^店舗名/)).not.toHaveAttribute('aria-describedby');
  });
});

describe('担当者名', () => {
  test('既定は「代表者と同じ」で担当者名の欄を出さず、同じ値を送る（API には両方を送る）', async () => {
    await mount(); fillStep1();
    expect(screen.getByRole('checkbox', { name: '担当者も代表者と同じ' })).toBeChecked();
    expect(screen.queryByLabelText(/^担当者名/)).not.toBeInTheDocument();
    await toStep3();
    const payload = await submitAndReadPayload();
    expect(payload.representative_name).toBe('合成代表');
    expect(payload.contact_name).toBe('合成代表');
  });

  test('チェックを外すと担当者名を別に入力できる', async () => {
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('checkbox', { name: '担当者も代表者と同じ' }));
    const contact = screen.getByLabelText(/^担当者名/);
    expect(contact).toHaveValue('合成代表');
    fireEvent.change(contact, { target: { value: '合成担当' } });
    await toStep3();
    const payload = await submitAndReadPayload();
    expect(payload.contact_name).toBe('合成担当');
    expect(payload.representative_name).toBe('合成代表');
  });
});

describe('入力補助', () => {
  test('自動入力（autocomplete）の種類を付ける', async () => {
    await mount();
    expect(screen.getByLabelText(/^店舗名/)).toHaveAttribute('autocomplete', 'organization');
    expect(screen.getByLabelText(/^代表者名/)).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('WebサイトURL')).toHaveAttribute('autocomplete', 'url');
    expect(screen.getByLabelText(/^電話番号/)).toHaveAttribute('autocomplete', 'tel');
    fillStep1(); fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(await screen.findByLabelText(/^郵便番号/)).toHaveAttribute('autocomplete', 'postal-code');
  });

  test('セレクトは iOS の既定の見た目を外し、入力欄と同じ高さにそろえる', async () => {
    await mount();
    const select = screen.getByLabelText(/^業種/);
    expect(select).toHaveClass('appearance-none');
    expect(select).toHaveClass('form-input');
    expect(select.parentElement!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('全角の郵便番号でも検証を通り、住所の自動補完が動く', async () => {
    mockFetch.mockImplementation(async (url: string) => url.startsWith('https://zipcloud')
      ? jsonResponse(200, { results: [{ address1: '大阪府', address2: '堺市堺区', address3: '南花田口町' }] })
      : jsonResponse(200, { success: true, id }));
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    const postal = await screen.findByLabelText(/^郵便番号/);
    fireEvent.change(postal, { target: { value: '５９０－００７５' } });
    await waitFor(() => expect(screen.getByLabelText('住所')).toHaveValue('大阪府堺市堺区南花田口町'));
    expect(mockFetch.mock.calls.some(([url]) => url === 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=5900075')).toBe(true);
    fireEvent.blur(postal);
    expect(postal).toHaveValue('590-0075');
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByRole('button', { name: '登録する' });
    const payload = await submitAndReadPayload();
    expect(payload.postal_code).toBe('590-0075');
  });

  test('スキームを省いた Web サイトは https:// を補って受け付ける', async () => {
    await mount(); fillStep1();
    const website = screen.getByLabelText('WebサイトURL');
    fireEvent.change(website, { target: { value: 'example.com' } });
    fireEvent.blur(website);
    expect(website).toHaveValue('https://example.com');
    await toStep3();
    const payload = await submitAndReadPayload();
    expect(payload.website).toBe('https://example.com');
  });
});

describe('詳細情報', () => {
  test('「駐車場あり」のチップは出さず（チェックボックスと重複）、検索用に features へは反映する', async () => {
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByLabelText(/^郵便番号/);
    const group = screen.getByRole('group', { name: /こだわり・特徴/ });
    expect(group.tagName).toBe('FIELDSET');
    expect(within(group).queryByRole('button', { name: /駐車場あり/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '駐車場あり' }));
    fireEvent.click(within(group).getByRole('button', { name: /個室あり/ }));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByRole('button', { name: '登録する' });
    const payload = await submitAndReadPayload();
    expect(payload.has_parking).toBe(true);
    expect(payload.features).toEqual(expect.arrayContaining(['駐車場あり', '個室あり']));
  });

  test('駐車場のチェックを外すと features からも外れる', async () => {
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByLabelText(/^郵便番号/);
    const parking = screen.getByRole('checkbox', { name: '駐車場あり' });
    fireEvent.click(parking); fireEvent.click(parking);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByRole('button', { name: '登録する' });
    const payload = await submitAndReadPayload();
    expect(payload.has_parking).toBe(false);
    expect(payload.features).not.toContain('駐車場あり');
  });

  test('こだわりチップは押しやすい大きさで、テーマの色を使う', async () => {
    await mount(); fillStep1();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByLabelText(/^郵便番号/);
    const chip = within(screen.getByRole('group', { name: /こだわり・特徴/ })).getByRole('button', { name: /個室あり/ });
    expect(chip.className).toMatch(/min-h-11/);
    expect(chip.className).toMatch(/text-sm/);
    expect(chip.className).not.toMatch(/sky-/);
    fireEvent.click(chip);
    expect(chip.className).toMatch(/--ecru-accent/);
  });
});

describe('PR情報', () => {
  test('写真欄は fieldset/legend で、注記は実際の公開条件（単一ソース）と一致する', async () => {
    await mount(); fillStep1(); await toStep3();
    const photos = screen.getByRole('group', { name: /店舗の写真/ });
    expect(photos.tagName).toBe('FIELDSET');
    expect(photos).toHaveTextContent(REGISTER_PHOTO_FIELD_NOTE);
    expect(photos).not.toHaveTextContent('公開時には写真の設定が必要です');
  });

  test('同意のチェックはテーマ色で、文中に余計な空白を入れない', async () => {
    await mount(); fillStep1(); await toStep3();
    const license = screen.getByRole('checkbox', { name: /当施設の運営に法令上必要な許可/ });
    expect(license.className).toMatch(/accent-\(--ecru-accent\)/);
    expect(license.closest('label')!.textContent).toContain('開設届等）をすべて完了');
  });
});

describe('入力途中のページ移動', () => {
  /** jsdom はページ遷移を実装していないので、リンクまで届いたクリックはここで記録して止める。 */
  const reached = jest.fn();
  function withLink(href: string) {
    const anchor = document.createElement('a');
    anchor.href = href; anchor.textContent = 'アプリ内リンク';
    anchor.addEventListener('click', event => { reached(href); event.preventDefault(); });
    document.body.appendChild(anchor);
    return anchor;
  }
  beforeEach(() => reached.mockClear());

  test('入力中にアプリ内リンクを押すと確認を挟み、「入力を続ける」なら移動しない', async () => {
    await mount(); fillStep1();
    const link = withLink('/search');
    fireEvent.click(link);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('入力途中のままページを移動しますか？');
    expect(reached).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '入力を続ける' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^店舗名/)).toHaveValue('合成施設');
    link.remove();
  });

  test('「移動する」を選んだときだけ移動する', async () => {
    await mount(); fillStep1();
    const link = withLink('/search?type=hair');
    fireEvent.click(link);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '移動する' }));
    expect(mockPush).toHaveBeenCalledWith('/search?type=hair');
    link.remove();
  });

  test('未入力・新しいタブ・修飾キー付きのクリックは止めない', async () => {
    await mount();
    const link = withLink('/search');
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fillStep1();
    const blank = withLink('/terms'); blank.target = '_blank';
    fireEvent.click(blank);
    fireEvent.click(link, { metaKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reached.mock.calls.map(([href]) => href)).toEqual(['/search', '/terms', '/search']);
    link.remove(); blank.remove();
  });

  test('外部サイトと同じページ内のアンカーは対象外（外部は beforeunload が受け持つ）', async () => {
    await mount(); fillStep1();
    const external = withLink('https://example.invalid/');
    const anchor = withLink('#register-form');
    act(() => { fireEvent.click(external); fireEvent.click(anchor); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reached).toHaveBeenCalledTimes(2);
    external.remove(); anchor.remove();
  });
});
