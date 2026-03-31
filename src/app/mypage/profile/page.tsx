'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
        setAvatarUrl(data.avatar_url || null);
      }
      setLoading(false);
    };
    loadProfile().catch(() => setLoading(false));
  }, [reset]);

  const onSubmit = async (data: ProfileForm) => {
    try {
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
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', message: body?.error || '更新に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
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
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6 pb-6 border-b">
          <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center overflow-hidden shrink-0 relative">
            {avatarUrl ? (
              <Image src={avatarUrl} alt="プロフィール" fill className="object-cover" sizes="64px" />
            ) : (
              <svg className="w-8 h-8 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            )}
          </div>
          <div>
            <label className="text-sm text-sky-600 font-medium cursor-pointer hover:underline">
              {uploading ? 'アップロード中...' : '写真を変更'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) { setToast({ type: 'error', message: '5MB以下の画像を選択してください' }); return; }
                  setUploading(true);
                  try {
                    const supabase = createBrowserSupabaseClient();
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const ext = file.name.split('.').pop() || 'jpg';
                    const path = `${user.id}/avatar.${ext}`;
                    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
                    if (uploadError) throw uploadError;
                    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
                    const url = `${urlData.publicUrl}?t=${Date.now()}`;
                    await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
                    setAvatarUrl(url);
                    setToast({ type: 'success', message: '写真を更新しました' });
                  } catch { setToast({ type: 'error', message: 'アップロードに失敗しました' }); }
                  setUploading(false);
                }}
              />
            </label>
            <p className="text-xs text-gray-400 mt-0.5">JPEG/PNG/WebP, 5MB以下</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div>
            <label htmlFor="profile-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
            <input
              {...register('display_name', { required: 'お名前は必須です' })}
              id="profile-name"
              className="form-input"
              aria-required="true"
            />
            {errors.display_name && <p className="form-error" role="alert">{errors.display_name.message}</p>}
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
