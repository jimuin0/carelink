import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import BrowseLink from '@/components/BrowseLink';

/**
 * 共通ボタン（デザイン統一フェーズ1・2026年10月23日）。
 *
 * why: 本番の来院者向け画面でボタンの見た目が 13 通りに割れていた（角丸 4/8/12px/丸、
 *   高さ 32〜56px、グラデーション・影の有無がページごとに違う）。色・角丸・高さ・フォーカス表示を
 *   ここに集約し、画面側は「どの強さの操作か（variant）」と「大きさ（size）」だけを選ぶ。
 *
 * 色は CSS 変数（globals.css の --primary / --primary-dark）を見るので、店舗向けの
 * くすみテーマ（.theme-ecru）の内側では自動でテーマ色になる。コントラスト（WCAG AA 4.5:1）は計算済み:
 *   primary   … 白文字 / #0369A1 5.93:1（hover #075985 7.56:1）／ くすみ #8E6A61 4.79:1（hover #7A5952 6.22:1）
 *   secondary … #0369A1 / 白 5.93:1（hover #075985 7.56:1）／ くすみ #8E6A61 / 白 4.79:1
 *   ghost     … gray-700 #374151 / 白 10.31:1（hover 地 gray-100 で 9.37:1）
 *   danger    … 白文字 / red-700 #B91C1C 6.47:1（hover red-800 8.31:1）
 *   disabled  … gray-600 #4B5563 / gray-300 #D1D5DB 5.13:1（白地の枠線型は 7.56:1）
 *   フォーカス枠 … --primary（白地で 5.93:1。既定の sky-500 枠は白地 2.77:1 で非テキスト 3:1 に届かない）
 *
 * 大きさ: sm=36px / md=44px（タップ領域の推奨値・既定）/ lg=52px。高さは min-h なので 2 行に折れても潰れない。
 * 角丸は `rounded-control`（globals.css の --radius-control＝12px）だけを使う。
 *
 * `href` を渡すとリンク（<a>）として描く。内部リンクは BrowseLink（既定で先読みしない）を通す。
 * 「次に必ず押される」導線で従来どおり先読みさせたい場合は `prefetch="auto"` を明示する
 * （理由と実測は components/BrowseLink.tsx）。tel: / mailto: / 外部 URL / data: / # は素の <a> で描く。
 *
 * `className` は配置（幅・余白・flex 等）の追加にだけ使う。色・角丸・高さ・文字サイズを上書きしない
 * （上書きが必要になったら variant / size を足す）。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-bold text-center leading-snug ' +
  'transition-colors duration-150 select-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary) ' +
  'disabled:cursor-not-allowed';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-(--primary) text-white hover:bg-(--primary-dark) ' +
    'disabled:bg-gray-300 disabled:text-gray-600 disabled:hover:bg-gray-300',
  secondary:
    'border-2 border-(--primary) bg-white text-(--primary) hover:border-(--primary-dark) hover:text-(--primary-dark) ' +
    'disabled:border-gray-300 disabled:text-gray-600 disabled:hover:border-gray-300 disabled:hover:text-gray-600',
  ghost:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 ' +
    'disabled:text-gray-600 disabled:hover:bg-white',
  danger:
    'bg-red-700 text-white hover:bg-red-800 ' +
    'disabled:bg-gray-300 disabled:text-gray-600 disabled:hover:bg-gray-300',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-5 text-sm',
  lg: 'min-h-13 px-6 text-base',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Button と同じ見た目のクラス文字列（<label> 等、要素を差し替えられない場所用）。 */
export function buttonClassName({ variant = 'primary', size = 'md', fullWidth = false, className }: ButtonStyleOptions = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : '', className ?? ''].filter(Boolean).join(' ');
}

type CommonProps = Omit<ButtonStyleOptions, 'className'> & { className?: string; children?: ReactNode };

export type ButtonAsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };

export type ButtonAsLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> & {
    href: string;
    prefetch?: ComponentProps<typeof BrowseLink>['prefetch'];
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

/** tel: / mailto: / http(s): / data: / blob: / ページ内アンカーは Next のルーターを通さない。 */
function isPlainAnchor(href: string): boolean {
  return /^(tel:|mailto:|https?:|data:|blob:|#)/i.test(href);
}

export default function Button(props: ButtonProps) {
  const { variant, size, fullWidth, className, children } = props;
  const classes = buttonClassName({ variant, size, fullWidth, className });

  if (props.href !== undefined) {
    const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, href, prefetch, ...rest } = props;
    if (isPlainAnchor(href)) {
      return (
        <a href={href} className={classes} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <BrowseLink href={href} className={classes} {...(prefetch !== undefined ? { prefetch } : {})} {...rest}>
        {children}
      </BrowseLink>
    );
  }

  const { variant: _v, size: _s, fullWidth: _f, className: _c, children: _ch, href: _h, type = 'button', ...rest } = props;
  return (
    // type の既定は "button"（フォーム内に置いたとき意図せず送信しないため）。送信ボタンは type="submit" を明示する。
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
