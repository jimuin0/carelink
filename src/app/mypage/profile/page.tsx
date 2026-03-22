'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { prefectures } from '@/lib/constants';
import Toast from '@/components/Toast';

interface ProfileForm {
  display_name: string;
  phone: string;
  prefecture: string;
  city: string;
  birth_date: string;
  gender: string;
}

export default function ProfileEditPage() {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const { register, handleSubmit, reset, formState: { isSubmitting, errors } } = useForm<ProfileForm>();

  useEffect(() => {
    const loadProfile = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (data) {
        reset({
          display_name: data.display_name || '',
          phone: data.phone || '',
          prefecture: data.prefecture || '',
          city: data.city || '',
          birth_date: data.birth_date || '',
          gender: data.gender || '',
        });
      }
      setLoading(false);
    };
    loadProfile().catch(() => setLoading(false));
  }, [reset]);

  const onSubmit = async (data: ProfileForm) => {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: data.display_name,
        phone: data.phone || null,
        prefecture: data.prefecture || null,
        city: data.city || null,
        birth_date: data.birth_date || null,
        gender: data.gender || null,
      }),
    });

    if (res.ok) {
      setToast({ type: 'success', message: 'プロフィールを更新しました' });
    } else {
      const { error } = await res.json();
      setToast({ type: 'error', message: error || '更新に失敗しました' });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-6" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">プロフィール編集</h1>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
            <input
              {...register('display_name', { required: 'お名前は必須です' })}
              id="profile-name"
              className="form-input"
            />
            {errors.display_name && <p className="form-error">{errors.display_name.message}</p>}
          </div>

          <div>
            <label htmlFor="profile-phone" className="form-label">電話番号</label>
            <input
              {...register('phone')}
              id="profile-phone"
              type="tel"
              className="form-input"
              placeholder="090-1234-5678"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-prefecture" className="form-label">都道府県</label>
              <select {...register('prefecture')} id="profile-prefecture" className="form-input">
                <option value="">選択してください</option>
                {prefectures.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="profile-city" className="form-label">市区町村</label>
              <input {...register('city')} id="profile-city" className="form-input" />
            </div>
          </div>

          <div>
            <label htmlFor="profile-birth" className="form-label">生年月日</label>
            <input
              {...register('birth_date')}
              id="profile-birth"
              type="date"
              className="form-input"
            />
          </div>

          <div>
            <label htmlFor="profile-gender" className="form-label">性別</label>
            <select {...register('gender')} id="profile-gender" className="form-input">
              <option value="">選択してください</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
              <option value="unspecified">回答しない</option>
            </select>
          </div>

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3">
            {isSubmitting ? '更新中...' : 'プロフィールを更新'}
          </button>
        </form>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
