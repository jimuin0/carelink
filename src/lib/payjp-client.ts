/**
 * ブラウザで payjp.js v2（https://js.pay.jp/v2/pay.js）を読み込む共通部品（広告枠・有料オプションで共用）。
 * カード入力欄は PAY.JP の iframe で描かれ、カード番号は CareLink を通らない。読み込みは 1 回だけ。
 * 型は CareLink で使う部分だけ（https://docs.pay.jp/v1/payjs）。
 */
export type PayjpCardElement = { mount: (selector: string) => void; unmount: () => void };
export type PayjpTokenResult = { id?: string; error?: { message?: string } };
export type PayjpClient = {
  elements: () => { create: (type: 'card') => PayjpCardElement };
  createToken: (element: PayjpCardElement) => Promise<PayjpTokenResult>;
};
declare global {
  interface Window { Payjp?: (publicKey: string) => PayjpClient }
}

export const PAYJP_JS = 'https://js.pay.jp/v2/pay.js';

export function loadPayjp(): Promise<NonNullable<Window['Payjp']>> {
  if (window.Payjp) return Promise.resolve(window.Payjp);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PAYJP_JS}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => (window.Payjp ? resolve(window.Payjp) : reject(new Error('payjp.js unavailable'))));
    script.addEventListener('error', () => reject(new Error('payjp.js failed to load')));
    if (!existing) {
      script.src = PAYJP_JS;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}
