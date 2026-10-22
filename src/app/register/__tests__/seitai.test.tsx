/**
 * @jest-environment jsdom
 *
 * 業種「鍼灸院・整骨院」に整体を含めた（2026年10月23日 神原さん決定）ことの、申し込み画面での見え方。
 *   - 業種の選択肢は「鍼灸院・整骨院・整体」と表示し、送信値は従来の「鍼灸院・整骨院」
 *   - 許認可の表明は、国家資格の無い整体の店舗でも事実どおりにチェックできる文言
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RegisterLanding from '@/components/register/RegisterLanding';
import { LICENSE_WARRANTY_TEXT } from '@/lib/registration-consent';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

beforeEach(() => sessionStorage.clear());

test('業種の選択肢は整体を含む表示名・送信値は従来の保存値', () => {
  render(<RegisterLanding />);
  const select = screen.getByLabelText(/^業種/) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.value === '鍼灸院・整骨院');
  expect(option).toBeDefined();
  expect(option!.textContent).toBe('鍼灸院・整骨院・整体');
  // 表示名を value にしない（DB 側の受付関数が拒否する）
  expect(Array.from(select.options).some((o) => o.value === '鍼灸院・整骨院・整体')).toBe(false);
});

test('許認可の表明は資格が法令上必要な施術に限って資格者を約束する', async () => {
  expect(LICENSE_WARRANTY_TEXT).toContain('国家資格が必要な施術（あん摩マッサージ指圧・鍼・灸・柔道整復など）は、その資格を持つ者が行っている');
  // 旧文言（整体には当てはまらない「施術は必要な資格を有する者が提供」）へ戻さない
  expect(LICENSE_WARRANTY_TEXT).not.toContain('施術は必要な資格を有する者が提供');
  // 許可・届出の部分は従来どおり
  expect(LICENSE_WARRANTY_TEXT).toContain('当施設の運営に法令上必要な許可・免許・届出（美容所開設届、施術所開設届、診療所開設届等）をすべて完了しており');
});
