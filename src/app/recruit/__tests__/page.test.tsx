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

// getRecaptchaToken は本物を呼ぶと <script> onload を待って jsdom でハングする
// （register/contact/symptoms の各テストと同じ既知の地雷）。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
}));

afterEach(() => {
  jest.restoreAllMocks();
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
    expect(alertEl).toHaveTextContent('登録に失敗しました。時間をおいて再度お試しください。');
    expect(alertEl.textContent).not.toMatch(/registration failed/i);
  });

  test('送信成功時は完了画面を表示する（回帰・成功経路は変えない）', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/salons') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, id: 'salon-1' }) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;

    const { container } = render(<RecruitPage />);
    await advanceToStep2AndSubmit(container);

    await waitFor(() => {
      expect(screen.getByText('掲載申し込みが完了しました')).toBeInTheDocument();
    });
  });
});
