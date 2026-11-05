/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import RegistrationFlow from './RegistrationFlow';
import { REGISTRATION_STEPS, registrationStepHeading } from '@/lib/registration-flow';

const items = () => within(screen.getByRole('list', { name: '掲載までの4ステップ' })).getAllByRole('listitem');

test('いまの手順を文字と aria-current で示し、済んだ手順は読み上げでも「済」と分かる', () => {
  render(<RegistrationFlow current="documents" />);
  const [apply, account, documents, publish] = items();
  expect(apply).toHaveTextContent('申し込む（済）');
  expect(account).toHaveTextContent('アカウント作成（済）');
  expect(documents).toHaveAttribute('aria-current', 'step');
  expect(documents).toHaveTextContent('いまここ');
  expect(publish).not.toHaveAttribute('aria-current');
  expect(publish).not.toHaveTextContent('済');
  expect(screen.getAllByText('いまここ')).toHaveLength(1);
});

test('current を渡さなければ「済」「いまここ」を出さず、detailed で一言の説明を出す', () => {
  render(<RegistrationFlow detailed />);
  expect(screen.queryByText('いまここ')).toBeNull();
  expect(screen.queryByText('済')).toBeNull();
  REGISTRATION_STEPS.forEach((step, index) => expect(items()[index]).toHaveTextContent(step.detail));
});

test('メールの見出しは図と同じ名前を番号付きで使う', () => {
  expect(registrationStepHeading('apply', true)).toBe('【1】申し込む（済）');
  expect(registrationStepHeading('publish')).toBe('【4】公開');
});

test('見出しの区切り位置（parts）を連結すると、メールと同じ title になる', () => {
  for (const step of REGISTRATION_STEPS) expect(step.parts.join('')).toBe(step.title);
});
