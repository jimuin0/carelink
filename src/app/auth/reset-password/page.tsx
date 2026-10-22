'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import {
  clearPasswordRecovery,
  getPasswordRecoveryUser,
  recoveryUnavailableReason,
  subscribePasswordRecovery,
  type PasswordRecoveryUser,
  type RecoveryInitError,
  type RecoveryUnavailableReason,
} from '@/lib/password-recovery-session';
import {
  describePasswordUpdateError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_HINT,
  PASSWORD_UPDATE_RETRY_MESSAGE,
  RECOVERY_LINK_EXPIRED_MESSAGE,
  resetPasswordSchema,
  type PasswordUpdateFailure,
  type ResetPasswordFormData,
} from '@/lib/password-reset';
import Toast from '@/components/Toast';

// フォームを出してよいのは、このページ読み込みで再設定リンクから回復用セッションが作られたときだけ。
// ブラウザに元から在るセッション（別アカウントでログイン中など）へ updateUser を呼ぶと、
// そのアカウントのパスワードを書き換えてしまうため（詳細は password-recovery-session.ts）。
type RecoveryState =
  | { status: 'checking' }
  | { status: 'ready'; user: PasswordRecoveryUser }
  | { status: 'unavailable'; reason: RecoveryUnavailableReason };

function readRecoveryState(initError: RecoveryInitError): RecoveryState {
  const user = getPasswordRecoveryUser();
  if (user) return { status: 'ready', user };
  return { status: 'unavailable', reason: recoveryUnavailableReason(window.location.href, initError) };
}

const REQUEST_AGAIN_LABEL = '再設定をもう一度申請する';

// 原因ごとの案内。先頭の 1 文を主な原因として太字で出す。
const UNAVAILABLE_NOTICES: Record<RecoveryUnavailableReason, { headline: string; details: string[] }> = {
  expired: {
    headline: 'このリンクは有効期限が切れているか、すでに使用されています。',
    details: ['お手数ですが、もう一度再設定を申請してください。'],
  },
  'other-browser': {
    headline: '再設定を申請したのと同じブラウザでリンクを開いてください。',
    details: [
      'メールアプリ内のブラウザで開いている場合は、メニューの「ブラウザで開く」を選ぶか、このページのアドレスをコピーして、再設定を申請したブラウザで開いてください。',
      'このページのアドレスは時間がたつと使えなくなります。その場合は、もう一度申請してください。',
    ],
  },
  ended: {
    headline: 'パスワードを再設定できませんでした。',
    details: [
      '再設定のリンクは一度しか使えず、有効期限もあります。お手数ですが、もう一度申請してください。',
      '新しいリンクは、申請したのと同じブラウザで開いてください。',
    ],
  },
};

export default function ResetPasswordPage() {
  const router = useRouter();
  const [recovery, setRecovery] = useState<RecoveryState>({ status: 'checking' });
  const [failure, setFailure] = useState<PasswordUpdateFailure | null>(null);
  const [completed, setCompleted] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const requestAgainRef = useRef<HTMLAnchorElement>(null);
  const previousStatus = useRef(recovery.status);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    let active = true;
    let initError: RecoveryInitError = null;
    const sync = () => { if (active) setRecovery(readRecoveryState(initError)); };
    // 判定後に届いた通知（他タブでのログアウト・遅れて届いた PASSWORD_RECOVERY）にも追従する。
    const unsubscribe = subscribePasswordRecovery(sync);
    void Promise.resolve()
      .then(() => createBrowserSupabaseClient().auth.initialize())
      .then(({ error }) => { initError = error; })
      // SDK は URL の認証コードを交換し終えた後、setTimeout(0) で PASSWORD_RECOVERY を通知する。
      // 初期化の完了直後に判定すると、その通知より先に「再設定できません」を出してしまう。
      .then(() => new Promise<void>(resolve => { setTimeout(resolve, 0); }))
      .then(sync, () => { if (active) setRecovery({ status: 'unavailable', reason: 'ended' }); });
    return () => { active = false; unsubscribe(); };
  }, []);

  // 入力中にフォームが消えたとき（別タブでのログアウト・アカウントの切り替え）は、
  // 押したボタンと一緒にフォーカスも消えるので、代わりに表示した案内へ移す。
  useEffect(() => {
    if (previousStatus.current === 'ready' && recovery.status === 'unavailable') noticeRef.current?.focus();
    previousStatus.current = recovery.status;
  }, [recovery.status]);

  // 再設定リンクを申請し直すしかなくなったら、その導線へフォーカスを移す（送信ボタンは押せなくなる）。
  useEffect(() => {
    if (failure?.requestNewLink) requestAgainRef.current?.focus();
  }, [failure]);

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (recovery.status !== 'ready') return;
    setFailure(null);
    try {
      const supabase = createBrowserSupabaseClient();
      // 送信直前にも、保存されているセッションが再設定リンクで作られたものかを確かめる。
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        // 一時的な通信失敗などで確認できなかっただけ。回復用セッションは保存されたままなので、
        // ここで記録を消すとやり直せなくなる（再読み込みしても PASSWORD_RECOVERY は二度と来ない）。
        setFailure({ message: PASSWORD_UPDATE_RETRY_MESSAGE, requestNewLink: false });
        return;
      }
      if (!session) {
        clearPasswordRecovery();
        setFailure({ message: RECOVERY_LINK_EXPIRED_MESSAGE, requestNewLink: true });
        return;
      }
      if (session.user.id !== recovery.user.id) {
        // 別タブで別アカウントにログインされた。そのアカウントのパスワードは変更しない。
        clearPasswordRecovery();
        setRecovery({ status: 'unavailable', reason: 'ended' });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: data.password });
      if (error) {
        setFailure(describePasswordUpdateError(error));
        return;
      }
    } catch {
      setFailure({ message: PASSWORD_UPDATE_RETRY_MESSAGE, requestNewLink: false });
      return;
    }

    clearPasswordRecovery();
    setCompleted(true);
    setToast({ type: 'success', message: 'パスワードを更新しました。ログインページに移動します。' });
    setTimeout(() => {
      router.push('/auth/login');
    }, 2000);
  };

  // リンクの申請し直しが必要になったら、同じセッションで何度送っても通らないので入力を止める。
  const locked = completed || failure?.requestNewLink === true;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-2">新しいパスワードを設定</h1>

          {recovery.status === 'checking' && (
            <p role="status" className="text-gray-600 text-sm text-center mt-6">リンクを確認しています…</p>
          )}

          {recovery.status === 'unavailable' && (
            <div role="alert" className="mt-6 space-y-3 text-sm text-gray-700">
              <p ref={noticeRef} tabIndex={-1} className="font-bold text-gray-900">
                {UNAVAILABLE_NOTICES[recovery.reason].headline}
              </p>
              {UNAVAILABLE_NOTICES[recovery.reason].details.map(detail => <p key={detail}>{detail}</p>)}
              <Link href="/auth/forgot-password" className="btn-primary w-full py-3! mt-4 inline-block text-center">
                {REQUEST_AGAIN_LABEL}
              </Link>
            </div>
          )}

          {recovery.status === 'ready' && (
            <>
              <p className="text-gray-500 text-sm text-center mb-6">
                新しいパスワードを入力してください。
              </p>
              {recovery.user.email && (
                <div className="mb-6 rounded-lg bg-gray-100 px-4 py-3 text-sm">
                  <p className="text-gray-600">パスワードを変更するアカウント</p>
                  <p className="font-bold text-gray-900 break-all" data-testid="recovery-email">{recovery.user.email}</p>
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="form-label">新しいパスワード</label>
                  <input
                    {...register('password')}
                    id="new-password"
                    type="password"
                    className="form-input"
                    placeholder={`${PASSWORD_MIN_LENGTH}文字以上`}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-describedby="new-password-hint"
                    disabled={locked}
                  />
                  <p id="new-password-hint" className="text-xs text-gray-500 mt-1">
                    {PASSWORD_RULES_HINT}
                  </p>
                  {errors.password && <p className="form-error" role="alert">{errors.password.message}</p>}
                </div>

                <div>
                  <label htmlFor="new-password-confirm" className="form-label">パスワード（確認）</label>
                  <input
                    {...register('password_confirm')}
                    id="new-password-confirm"
                    type="password"
                    className="form-input"
                    placeholder="もう一度入力"
                    autoComplete="new-password"
                    aria-required="true"
                    disabled={locked}
                  />
                  {errors.password_confirm && <p className="form-error" role="alert">{errors.password_confirm.message}</p>}
                </div>

                {failure && (
                  <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    <p>{failure.message}</p>
                    {failure.requestNewLink && (
                      <Link ref={requestAgainRef} href="/auth/forgot-password" className="mt-2 inline-block font-bold underline">
                        {REQUEST_AGAIN_LABEL}
                      </Link>
                    )}
                  </div>
                )}

                <button type="submit" disabled={isSubmitting || locked} className="btn-primary w-full py-3!">
                  {isSubmitting ? '更新中...' : 'パスワードを更新'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
