'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import {
  clearPasswordRecovery,
  getPasswordRecoveryUser,
  subscribePasswordRecovery,
  type PasswordRecoveryUser,
} from '@/lib/password-recovery-session';
import {
  describePasswordUpdateError,
  PASSWORD_UPDATE_RETRY_MESSAGE,
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
  | { status: 'unavailable' };

function readRecoveryState(): RecoveryState {
  const user = getPasswordRecoveryUser();
  return user ? { status: 'ready', user } : { status: 'unavailable' };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [recovery, setRecovery] = useState<RecoveryState>({ status: 'checking' });
  const [failure, setFailure] = useState<PasswordUpdateFailure | null>(null);
  const [completed, setCompleted] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    let active = true;
    const sync = () => { if (active) setRecovery(readRecoveryState()); };
    // 判定後に届いた通知（他タブでのログアウト・遅れて届いた PASSWORD_RECOVERY）にも追従する。
    const unsubscribe = subscribePasswordRecovery(sync);
    void Promise.resolve()
      .then(() => createBrowserSupabaseClient().auth.initialize())
      // SDK は URL の認証コードを交換し終えた後、setTimeout(0) で PASSWORD_RECOVERY を通知する。
      // 初期化の完了直後に判定すると、その通知より先に「再設定できません」を出してしまう。
      .then(() => new Promise<void>(resolve => { setTimeout(resolve, 0); }))
      .then(sync, sync);
    return () => { active = false; unsubscribe(); };
  }, []);

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (recovery.status !== 'ready') return;
    setFailure(null);
    try {
      const supabase = createBrowserSupabaseClient();
      // 送信直前にも、保存されているセッションが再設定リンクで作られたものかを確かめる。
      // 別タブでログアウト・別アカウントでログインされていたら、そのアカウントは変更しない。
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user.id !== recovery.user.id) {
        clearPasswordRecovery();
        setRecovery({ status: 'unavailable' });
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-2">新しいパスワードを設定</h1>

          {recovery.status === 'checking' && (
            <p role="status" className="text-gray-600 text-sm text-center mt-6">リンクを確認しています…</p>
          )}

          {recovery.status === 'unavailable' && (
            <div className="mt-6 space-y-3 text-sm text-gray-700">
              <p className="font-bold text-gray-900">パスワードを再設定できませんでした。</p>
              <p>再設定を申請したのと同じブラウザでリンクを開いてください。</p>
              <p>
                スマートフォンのメールアプリから開くと、別のブラウザで開かれることがあります。
                リンクの有効期限が切れている場合や、一度使ったリンクの場合は、もう一度申請してください。
              </p>
              <Link href="/auth/forgot-password" className="btn-primary w-full py-3! mt-4 inline-block text-center">
                再設定をもう一度申請する
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
                    placeholder="8文字以上"
                    autoComplete="new-password"
                    aria-required="true"
                    aria-describedby="new-password-hint"
                  />
                  <p id="new-password-hint" className="text-xs text-gray-500 mt-1">
                    8文字以上、半角72文字以内（全角文字は1文字を3文字分として数えます）
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
                  />
                  {errors.password_confirm && <p className="form-error" role="alert">{errors.password_confirm.message}</p>}
                </div>

                {failure && (
                  <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    <p>{failure.message}</p>
                    {failure.requestNewLink && (
                      <Link href="/auth/forgot-password" className="mt-2 inline-block font-bold underline">
                        再設定をもう一度申請する
                      </Link>
                    )}
                  </div>
                )}

                <button type="submit" disabled={isSubmitting || completed} className="btn-primary w-full py-3!">
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
