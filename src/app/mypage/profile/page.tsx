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
  const [lineLinked, setLineLinked] = useState(false);
  const [lineDisplayName, setLineDisplayName] = useState<string | null>(null);
  const [lineUnlinking, setLineUnlinking] = useState(false);

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

      // LINE連携状態チェック
      const { data: lineLink } = await supabase
        .from('line_user_links')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (lineLink) {
        setLineLinked(true);
        setLineDisplayName(lineLink.display_name);
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

      {/* LINE連携 */}
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">LINE連携</h2>
        {lineLinked ? (
          <div>
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg mb-4">
              <svg className="w-6 h-6 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              <div>
                <p className="text-sm font-medium text-green-800">LINE連携済み</p>
                {lineDisplayName && <p className="text-xs text-green-600 mt-0.5">{lineDisplayName}</p>}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">予約確認・リマインド・キャンセル通知がLINEに届きます。</p>
            <button
              onClick={async () => {
                if (!confirm('LINE連携を解除しますか？通知が届かなくなります。')) return;
                setLineUnlinking(true);
                try {
                  const supabase = createBrowserSupabaseClient();
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) {
                    await supabase.from('line_user_links').delete().eq('user_id', user.id);
                    setLineLinked(false);
                    setLineDisplayName(null);
                    setToast({ type: 'success', message: 'LINE連携を解除しました' });
                  }
                } catch {
                  setToast({ type: 'error', message: '解除に失敗しました' });
                } finally {
                  setLineUnlinking(false);
                }
              }}
              disabled={lineUnlinking}
              className="text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              {lineUnlinking ? '解除中...' : '連携を解除する'}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4">LINEアカウントを連携すると、予約確認・リマインド通知がLINEに届きます。</p>
            <a
              href={`https://line.me/R/ti/p/@549rbbyi`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#06C755] text-white font-bold rounded-lg hover:bg-[#05b04c] transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
              LINEで友だち追加
            </a>
            <p className="text-xs text-gray-400 mt-2">友だち追加後、CareLink上でアカウントが自動連携されます。</p>
          </div>
        )}
      </div>

      {/* アカウント削除（v8.5） */}
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-red-100">
        <h2 className="text-lg font-bold text-red-600 mb-2">アカウント削除</h2>
        <p className="text-xs text-gray-500 mb-4">
          アカウントを削除すると、予約履歴・お気に入り・ポイントなど全てのデータが完全に削除されます。この操作は取り消せません。
        </p>
        <button
          onClick={async () => {
            const input = prompt('本当に削除しますか？確認のため「DELETE」と入力してください。');
            if (input !== 'DELETE') return;
            const res = await fetch('/api/account/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ confirmation: 'DELETE' }),
            });
            if (res.ok) {
              alert('アカウントが削除されました。');
              window.location.href = '/';
            } else {
              setToast({ type: 'error', message: 'アカウント削除に失敗しました' });
            }
          }}
          className="text-xs text-red-500 hover:text-red-700 font-bold transition-colors"
        >
          アカウントを削除する
        </button>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
