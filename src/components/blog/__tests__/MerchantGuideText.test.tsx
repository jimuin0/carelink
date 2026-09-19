import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import MerchantGuideText from '../MerchantGuideText';

afterEach(cleanup);

describe('MerchantGuideText', () => {
  it('renders plain text, emphasis and a reviewed anchor', () => {
    const { container } = render(<MerchantGuideText text="条件を**確認**して[掲載へ](/register)" />);
    expect(container.textContent).toBe('条件を確認して掲載へ');
    expect(container.querySelector('strong')?.textContent).toBe('確認');
    expect(screen.getByRole('link', { name: '掲載へ' }).getAttribute('href')).toBe('/register');
  });

  it('renders HTML literally, with no script or image node', () => {
    const text = '<img src=x onerror=alert(1)><script>bad()</script>';
    const { container } = render(<MerchantGuideText text={text} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('script,img')).toBeNull();
  });

  it('does not link to an unapproved URL', () => {
    const text = '[不明](https://evil.test)';
    const { container } = render(<MerchantGuideText text={text} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('a')).toBeNull();
  });
});
