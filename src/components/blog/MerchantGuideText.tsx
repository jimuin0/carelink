import { Fragment } from 'react';
import { tokenizeMerchantInline } from '@/lib/merchant-guide';

/** Safe, deliberately limited inline rendering for reviewed merchant guides. */
export default function MerchantGuideText({ text }: { text: string }) {
  return (
    <>
      {tokenizeMerchantInline(text).map((token, index) => {
        if (token.type === 'strong') return <strong key={index}>{token.text}</strong>;
        if (token.type === 'link') {
          return (
            <a key={index} href={token.href} className="underline underline-offset-4 break-words">
              {token.text}
            </a>
          );
        }
        return <Fragment key={index}>{token.text}</Fragment>;
      })}
    </>
  );
}
