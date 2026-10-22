import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

/**
 * 「このページ読み込みで、再設定リンクから回復用セッションが作られたか」を覚えておく台帳。
 *
 * 🔴 /auth/reset-password は以前、ブラウザに【既に在るセッション】に対してそのまま
 * updateUser を呼んでいた。再設定を申請したのと別のブラウザでリンクを開くと PKCE の
 * code verifier が無いため認証コードは交換されず、代わりにそのブラウザでログイン中の
 * 【別アカウント】のパスワードが書き換わり得た。フォームを出してよいのは、
 * SDK が PASSWORD_RECOVERY を通知した（＝URL の認証コードを交換して回復用セッションを
 * 作った）ときだけにする。
 *
 * 🔴 なぜページではなくクライアント生成時に購読するのか: ブラウザ用クライアントは
 * シングルトンで、生成した瞬間に URL の認証コード交換を始め、終わると PASSWORD_RECOVERY を
 * 1 回だけ通知する。ヘッダー（AuthButton）など先にハイドレートされた部品がクライアントを
 * 作ると、ページ側が購読する前に通知が終わって取りこぼし、正しいリンクでも
 * 「同じブラウザで開いてください」と誤って案内してしまう（しかも認証コードは使用済みになる）。
 * そのため supabase-browser.ts が生成直後に watchPasswordRecovery を呼び、ここへ記録する。
 */

export type PasswordRecoveryUser = { id: string; email: string | null };

type AuthEvents = {
  onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => unknown;
};

let recoveryUser: PasswordRecoveryUser | null = null;
const listeners = new Set<() => void>();

export function watchPasswordRecovery(auth: AuthEvents): void {
  auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (event === 'PASSWORD_RECOVERY' && user) {
      recoveryUser = { id: user.id, email: user.email ?? null };
    } else if (recoveryUser && user?.id !== recoveryUser.id) {
      // ログアウトや別アカウントへの切り替え（他タブからの通知を含む）で、
      // 再設定の対象だったセッションはもう使えない。
      recoveryUser = null;
    } else {
      return;
    }
    listeners.forEach(listener => listener());
  });
}

export function getPasswordRecoveryUser(): PasswordRecoveryUser | null {
  return recoveryUser;
}

/** 記録が変わったときに呼ばれる。戻り値で購読を解除する。 */
export function subscribePasswordRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * パスワードを更新し終えたら呼ぶ（同じリンクで作られた記録を二度使わない）。
 * 購読者へは通知しない: 更新完了の画面がそのまま「再設定できません」に切り替わらないようにするため。
 */
export function clearPasswordRecovery(): void {
  recoveryUser = null;
}

/**
 * 回復用セッションが作られなかった理由。画面の案内文を出し分けるために使う。
 *
 * - `expired`       … リンクの有効期限切れ・使用済み（メールのセキュリティ機能が先に開いた場合も含む）。
 * - `other-browser` … URL に認証コードが残っているのに、このブラウザでは交換されなかった
 *                     （＝申請したブラウザに保存された PKCE の確認情報が無い）。
 * - `ended`         … それ以外（直接開いた・使い終えたページの再読み込み・途中でログアウト等）。
 *
 * 🔴 以前は理由に関係なく「同じブラウザで開いてください」を主な原因として出していた。
 * 実際に最も多い失敗は期限切れ・使用済みで、Supabase は /verify で拒否すると
 * `?error=access_denied&error_code=otp_expired`（PKCE ではクエリとフラグメントの両方）を付けて
 * 戻すので、それを見て正しい原因を伝える。
 */
export type RecoveryUnavailableReason = 'expired' | 'other-browser' | 'ended';

/** SDK の初期化（URL の認証コード交換）が返したエラーの、判定に使う部分だけ。 */
export type RecoveryInitError = { code?: string } | null;

// 同じブラウザで認証コードを交換しようとして、コードが使用済み・期限切れだったときのコード。
const LINK_USED_OR_EXPIRED_CODES = new Set([
  'otp_expired', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier',
]);

export function recoveryUnavailableReason(href: string, initError: RecoveryInitError): RecoveryUnavailableReason {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const read = (key: string) => url.searchParams.get(key) ?? fragment.get(key);
  if (read('error_code') === 'otp_expired' || read('error') === 'access_denied') return 'expired';
  if (read('error') !== null || read('error_code') !== null || read('error_description') !== null) return 'ended';
  if (!url.searchParams.has('code')) return 'ended';
  // 確認情報が無いブラウザでは SDK はコードを交換しようとせず、エラーも返さない。
  if (initError === null) return 'other-browser';
  return LINK_USED_OR_EXPIRED_CODES.has(initError.code ?? '') ? 'expired' : 'ended';
}
