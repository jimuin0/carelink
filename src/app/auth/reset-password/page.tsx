'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

const schema = z.object({
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  password_confirm: z.string(),
}).refine((data) => data.password === data.password_confirm, {
  message: 'パスワードが一致しません',
  path: ['password_confirm'],
});
type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.updateUser({
      password: data.password,
    });

    if (error) {
      setToast({ type: 'error', message: 'パスワードの更新に失敗しました。リンクの有効期限が切れている可能性があります。' });
      return;
    }

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
          <p className="text-gray-500 text-sm text-center mb-8">
            新しいパスワードを入力してください。
          </p>

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
              />
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

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3">
              {isSubmitting ? '更新中...' : 'パスワードを更新'}
            </button>
          </form>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
