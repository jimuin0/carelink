/**
 * @jest-environment jsdom
 *
 * /recruit ページの回帰テスト（2026年7月16日 恒久根治）。
 *
 * 1) クライアント側の電話バリデーションがサーバー側 src/lib/phone.ts の共通ヘルパー
 *    （先頭0必須の phoneRegex）と統一されたこと（従来の緩い /^[\d-]+$/ ではサーバーで
 *    弾かれる値をクライアントが素通ししていた不一致の根治）。
 * 2) 送信失敗時にサーバーのエラーJSON（error）を読み取り、日本語のみのメッセージを
 *    表示すること（従来は throw new Error('registration failed') で
 *    「登録に失敗しました: registration failed」という日英混在トーストになっていた）。
 *
 * 注: このページの <label> は htmlFor/id で input と結び付いていないため
 * （既存markup・本タスクのスコープ外）、getByLabelText は使えない。
 * react-hook-form の register() が付与する name 属性で要素を特定する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecruitPage from '@/app/recruit/page';
import { businessTypes } from '@/lib/constants';
import { salonInsertSchema } from '@/lib/validations';

// getRecaptchaToken は本物を呼ぶと <script> onload を待って jsdom でハングする
// （register/contact/symptoms の各テストと同じ既知の地雷）。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
}));

afterEach(() => {
  jest.restoreAllMocks();
});

test.each(businessTypes)('every displayed category %s submits a valid shared API contract and receipt', async (business_type) => {
  const id = '11111111-2222-4333-8444-555555555555';
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, id }) });
  global.fetch = fetchMock;
  const { container } = render(<RecruitPage />);
  const options = Array.from(screen.getByLabelText('業種 *').querySelectorAll('option')).map(option => option.value).filter(Boolean);
  expect(options).toEqual(businessTypes);
  fillStep1(container, { business_type });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText('郵便番号');
  fireEvent.click(screen.getByRole('button', { name: '掲載を申し込む' }));
  await screen.findByText('掲載申し込みが完了しました');
  expect(screen.getByText(`受付番号：${id}`)).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(salonInsertSchema.safeParse(JSON.parse(fetchMock.mock.calls[0][1].body)).success).toBe(true);
});

test.each(['network', 'missing-id', 'invalid-id', 'malformed', 'business-failure'])('%s cannot display false completion or allow blind retry', async (failure) => {
  const fetchMock = jest.fn();
  if (failure === 'network') fetchMock.mockRejectedValue(new Error('fixture connection lost'));
  else fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => {
    if (failure === 'malformed') throw new Error('fixture invalid JSON');
    return { success: failure !== 'business-failure', ...(failure === 'invalid-id' ? { id: 'invalid' } : {}) };
  } });
  global.fetch = fetchMock;
  const { container } = render(<RecruitPage />);
  fillStep1(container);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText('郵便番号');
  const submit = screen.getByRole('button', { name: '掲載を申し込む' });
  fireEvent.click(submit); fireEvent.click(submit);
  await screen.findByRole('alert');
  expect(submit).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('掲載申し込みが完了しました')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '受付状況を問い合わせる' })).toHaveAttribute('href', '/contact');
});

test('repeated server errors restore the correct step, focus and preserve input including PR mapping', async () => {
  const failure = (fieldErrors: Record<string, string>) => ({ ok: false, status: 400, json: async () => ({ error: '入力内容を確認してください', fieldErrors }) });
  const fetchMock = jest.fn().mockResolvedValueOnce(failure({ contact_name: 'invalid' })).mockResolvedValueOnce(failure({ contact_name: 'invalid' })).mockResolvedValueOnce(failure({ pr_text: 'invalid' }));
  global.fetch = fetchMock;
  const { container } = render(<RecruitPage />);
  fillStep1(container);
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    const description = await screen.findByLabelText('施設紹介');
    if (attempt === 0) fireEvent.change(description, { target: { value: '合成紹介文' } });
    else expect(description).toHaveValue('合成紹介文');
    fireEvent.click(screen.getByRole('button', { name: '掲載を申し込む' }));
    const contact = await screen.findByLabelText('担当者名 *');
    await waitFor(() => expect(contact).toHaveFocus());
    expect(contact).toHaveValue('山田花子');
    fireEvent.blur(contact);
  }
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText('施設紹介');
  fireEvent.click(screen.getByRole('button', { name: '掲載を申し込む' }));
  await waitFor(() => expect(screen.getByLabelText('施設紹介')).toHaveFocus());
  expect(screen.getByText('PR文を1000文字以内で入力してください')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

function fillStep1(container: HTMLElement, overrides: Partial<Record<'facility_name' | 'business_type' | 'representative_name' | 'contact_name' | 'email' | 'phone', string>> = {}) {
  const values = {
    facility_name: 'テスト施設',
    business_type: '鍼灸院・整骨院',
    representative_name: '山田太郎',
    contact_name: '山田花子',
    email: 'test@example.com',
    phone: '090-1234-5678',
    ...overrides,
  };
  const byName = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLElement;
  fireEvent.change(byName('facility_name'), { target: { value: values.facility_name } });
  fireEvent.change(byName('business_type'), { target: { value: values.business_type } });
  fireEvent.change(byName('representative_name'), { target: { value: values.representative_name } });
  fireEvent.change(byName('contact_name'), { target: { value: values.contact_name } });
  fireEvent.change(byName('email'), { target: { value: values.email } });
  fireEvent.change(byName('phone'), { target: { value: values.phone } });
}

describe('/recruit 電話番号バリデーション（src/lib/phone.ts への統一）', () => {
  test('先頭0が無い番号（従来の緩い正規表現では通過していた）は次へ進めない', async () => {
    const { container } = render(<RecruitPage />);
    fillStep1(container, { phone: '1234567890' }); // 先頭0なし・サーバー phoneRegex は拒否
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));

    await waitFor(() => {
      expect(screen.getByText('正しい電話番号を入力してください')).toBeInTheDocument();
    });
    // Step2 の項目（郵便番号）へは進まない
    expect(container.querySelector('[name="postal_code"]')).not.toBeInTheDocument();
  });

  test('桁数不足の値（サーバー正規表現の最小桁を満たさない）は次へ進めない', async () => {
    const { container } = render(<RecruitPage />);
    fillStep1(container, { phone: '0-1' }); // 短すぎる・サーバー正規表現の桁数を満たさない
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));

    await waitFor(() => {
      expect(screen.getByText('正しい電話番号を入力してください')).toBeInTheDocument();
    });
  });

  test('正しい形式（先頭0・携帯番号）は次へ進める', async () => {
    const { container } = render(<RecruitPage />);
    fillStep1(container, { phone: '090-1234-5678' });
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));

    await waitFor(() => {
      expect(container.querySelector('[name="postal_code"]')).toBeInTheDocument();
    });
  });
});

describe('/recruit 送信失敗時のエラー表示（サーバーJSON読み取り・日英混在の根治）', () => {
  async function advanceToStep2AndSubmit(container: HTMLElement) {
    fillStep1(container);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(container.querySelector('[name="postal_code"]')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '掲載を申し込む' }));
  }

  test('サーバーが具体的な理由（error）を返した場合、そのメッセージのみを日本語で表示する', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/salons') {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'Bot検知: 時間をおいて再度お試しください' }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    const { container } = render(<RecruitPage />);
    await advanceToStep2AndSubmit(container);

    const alertEl = await screen.findByRole('alert');
    expect(alertEl).toHaveTextContent('Bot検知: 時間をおいて再度お試しください');
    // 英語の固定文言 'registration failed' や二重prefixが混入しないこと
    expect(alertEl.textContent).not.toMatch(/registration failed/i);
    expect(alertEl.textContent).not.toMatch(/^登録に失敗しました:/);
  });

  test('サーバーがJSON以外（またはerrorフィールド無し）を返した場合は既定の日本語メッセージのみを表示する', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/salons') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('not json')),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    const { container } = render(<RecruitPage />);
    await advanceToStep2AndSubmit(container);

    const alertEl = await screen.findByRole('alert');
    expect(alertEl).toHaveTextContent('登録済みの可能性があります');
    expect(screen.getByRole('button', { name: '掲載を申し込む' })).toBeDisabled();
    expect(alertEl.textContent).not.toMatch(/registration failed/i);
  });

  test('送信成功時は完了画面を表示する（回帰・成功経路は変えない）', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/salons') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, id: '11111111-2222-4333-8444-555555555555' }) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    const { container } = render(<RecruitPage />);
    await advanceToStep2AndSubmit(container);

    await waitFor(() => {
      expect(screen.getByText('掲載申し込みが完了しました')).toBeInTheDocument();
    });
  });

  // 【2026年7月16日 恒久根治】/api/notify（認証なし公開POST）廃止に伴い、Slack通知は
  // /api/salons が保存成功後にサーバー側から直接送るよう移行した。/register 由来か
  // /recruit 由来かをサーバーが区別できるよう source フィールドを送る回帰テスト。
  test('/api/salons への送信ボディに source: "recruit" が含まれる（サーバー側Slack通知の振り分け用）', async () => {
    const fetchMock = jest.fn((url: string) => {
      if (url === '/api/salons') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, id: '11111111-2222-4333-8444-555555555555' }) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<RecruitPage />);
    await advanceToStep2AndSubmit(container);

    await waitFor(() => expect(screen.getByText('掲載申し込みが完了しました')).toBeInTheDocument());

    const [, options] = fetchMock.mock.calls.find(([url]) => url === '/api/salons')!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.source).toBe('recruit');
  });
});

describe('/recruit 電話番号入力の全角→半角正規化（onChange・恒久根治）', () => {
  // 【2026年7月16日 恒久根治】従来 onChange は replace(/[^\d-]/g, '') を先にかけており、
  // 全角数字「０９０」等が正規化される前に即除去され、サーバー側 normalizePhone
  // （NFKC 全角→半角）の効果が実UIから到達不能だった。normalizePhone を先に通してから
  // 絞ることで、全角入力もサーバーと同じ規則で半角化されることを検証する。
  test('全角数字・全角ハイフンを入力すると半角化されて保持される（旧実装は全角文字が \\d に一致せず即除去され空になっていた）', async () => {
    const { container } = render(<RecruitPage />);
    const phoneInput = container.querySelector('[name="phone"]') as HTMLInputElement;

    fireEvent.change(phoneInput, { target: { value: '０９０ー１２３４ー５６７８' } });

    // 旧実装（normalizePhone を通さず replace(/[^\d-]/g, '') を先にかける）だと
    // 全角数字・全角ハイフンは ASCII \d/- に一致しないため全て除去され '' になっていた。
    await waitFor(() => {
      expect(phoneInput.value.replace(/\D/g, '')).toBe('09012345678');
    });
  });
});
