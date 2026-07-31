/**
 * 送信元アドレス（EMAIL_FROM）の解決ロジック【SSOT】
 *
 * email.ts（実際に送る側）と /api/health（設定の正しさを外形監視する側）の両方が
 * 同じ規則を使うために切り出した純粋モジュール。片方だけ直して判定がずれると、
 * 「health は healthy なのにメールは届かない」という最悪の食い違いが起きる。
 */

/** Resend で検証済みのドメイン。ここに無いドメインを from に使うと Resend 側で拒否・制限される。 */
export const RESEND_VERIFIED_DOMAINS = ['carelink-jp.com'];

/** 既定の送信元のドメイン。RESEND_VERIFIED_DOMAINS に含まれることを単体テストで固定している。 */
export const DEFAULT_FROM_DOMAIN = 'carelink-jp.com';

/** 検証済みドメインで構成した、常に送信可能な既定の送信元。 */
export const DEFAULT_FROM = `CareLink <noreply@${DEFAULT_FROM_DOMAIN}>`;

/**
 * Resend が受理する from 形式は `email@example.com` または `Name <email@example.com>`。
 * 「email@domain.tld」の実体（@ の前後があり、ドメインに . がある）を含むかで妥当性を判定する。
 *
 * 【2026年7月8日・本番診断で確定】本番 EMAIL_FROM が「carelink-jp.com」等の不正形式
 * （@ を含まない＝メールアドレスでない）に設定されており、Resend が 422 validation_error で
 * 拒否していた。不正な env 値がコードの有効な既定値を上書きして送信全滅を招く。
 */
export function isValidFrom(from: string): boolean {
  return /[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+/.test(from);
}

/** from 文字列からドメイン部を取り出す（`Name <a@b.com>` と `a@b.com` の両形式に対応）。 */
export function domainOf(from: string): string | null {
  return from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? null;
}

export interface ResolvedFrom {
  /** 実際に送信で使う from。設定が不正でも必ず送信可能な値になる。 */
  from: string;
  /** env の生値（診断用）。 */
  raw: string;
  /** env の生値のドメイン部（診断用）。 */
  rawDomain: string | null;
  /**
   * 実際に送信に使われるドメイン。from は必ず有効形式（env 値か既定値）なので常に値がある。
   * null を許すと呼び出し側に到達不能な分岐が生まれるため、ここで確定させる。
   */
  sendingDomain: string;
  formatOk: boolean;
  domainOk: boolean;
  /** env 値を使わず既定値へ倒したか。 */
  fellBack: boolean;
}

/**
 * ニュースレター既定の送信元。EMAIL_FROM とは別アドレスにして、配信停止の扱いを分ける。
 * 検証済みドメインで構成する（未検証だと配信が丸ごと届かない）。
 */
export const DEFAULT_NEWSLETTER_FROM = `CareLink <newsletter@${DEFAULT_FROM_DOMAIN}>`;

/**
 * 環境変数から送信元を解決する【唯一の入口】。
 *
 * 【2026年7月31日・ガードの取りこぼしを塞ぐ】未検証ドメインへのフォールバックを
 * email.ts に入れただけでは不十分だった。実際には cron 5本
 * （review-request / waitlist-notify / customer-segment / birthday-coupon / webhook-retry）
 * とニュースレター配信が `process.env.EMAIL_FROM || '...'` を各自で組み立てて
 * resend.emails.send を直接呼んでおり、ガードを完全に迂回していた。
 * これらは予約リマインドや口コミ依頼など【ローンチ直後に客へ最初に届くメール】そのものである。
 *
 * 対策として env の読み取り自体をこの関数に閉じ込め、呼び出し側が process.env.EMAIL_FROM に
 * 触れないようにする。守り漏れは「どこかで env を直読みしていないか」という一点の検査に
 * 還元でき、テストで機械的に禁止できる（email-from-callers.test.ts）。
 */
export function resolvedFromEnv(): ResolvedFrom {
  return resolveFrom(process.env.EMAIL_FROM, process.env.NODE_ENV === 'production');
}

/** 実際に送信で使う from。全ての送信箇所はこれを使う。 */
export function fromEnv(): string {
  return resolvedFromEnv().from;
}

/**
 * 本番として解決したときの送信元ドメイン。/api/health が Resend の verified 一覧と
 * 突き合わせるために使う。監視は常に本番基準で見る（開発の値で緑にしない）。
 */
export function productionSendingDomain(): string {
  return resolveFrom(process.env.EMAIL_FROM, true).sendingDomain;
}

/** ニュースレター配信の送信元。EMAIL_FROM と同じ検証を通す。 */
export function newsletterFromEnv(): string {
  return resolveFrom(
    process.env.NEWSLETTER_EMAIL_FROM || DEFAULT_NEWSLETTER_FROM,
    process.env.NODE_ENV === 'production'
  ).from;
}

/**
 * 【2026年7月31日 恒久根治】旧実装は未検証ドメインを検知しても【警告するだけで、
 * 正しい値に倒していなかった】。コメント自身が「メール送信が全て失敗する可能性があります」と
 * 書いていたにもかかわらず、その失敗を防ぐ手当てが無かった。
 *
 * 警告だけでは足りない理由（本番実データ・2026年7月31日 確認）:
 *   - メール送信の対象がまだ 0 件（email_daily_summary=true の施設 0／完了予約 0／
 *     明日以降の予約 0）。つまりメール経路は【ローンチまで一度も実行されない】。
 *     誤設定があっても踏まないので、警告が出ても実害として顕在化せず埋もれる。
 *   - ローカル .env の EMAIL_FROM は `CareLink <onboarding@resend.dev>`。Resend 公式ドキュメントいわく
 *     resend.dev はテスト専用で【アカウント所有者本人のアドレスにしか送れない】。
 *     同じ値が本番に入っていれば、初めて客に送る一通目で初めて発症する。
 *
 * そこで本番実行時は【未検証ドメインを検証済みの既定値に倒す】。設定ミスがそのまま
 * 送信全滅に直結する構造をなくす。開発・テストは Resend のサンドボックス(resend.dev)を
 * 使うのが正常系のためドメインでは倒さない（形式不正だけは倒す＝typo で 422 にしない）。
 */
export function resolveFrom(rawInput: string | undefined, isProduction: boolean): ResolvedFrom {
  const raw = rawInput || DEFAULT_FROM;
  const rawDomain = domainOf(raw);
  const formatOk = isValidFrom(raw);
  const domainOk = !!rawDomain && RESEND_VERIFIED_DOMAINS.includes(rawDomain);
  const useRaw = isProduction ? formatOk && domainOk : formatOk;
  return {
    // useRaw は formatOk を含意し、formatOk なら rawDomain は必ず取れる（形式検査に @ が含まれるため）。
    from: useRaw ? raw : DEFAULT_FROM,
    sendingDomain: useRaw ? (rawDomain as string) : DEFAULT_FROM_DOMAIN,
    raw,
    rawDomain,
    formatOk,
    domainOk,
    fellBack: !useRaw,
  };
}
