'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import StarRating from './StarRating';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { getRecaptchaToken } from '@/lib/recaptcha-client';

const MAX_PHOTOS = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (before compression)
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB after compression
const MAX_DIMENSION = 1920; // px
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** 画像をリサイズ・圧縮してFileとして返す */
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      // Try quality levels until under MAX_OUTPUT_SIZE
      const tryCompress = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= MAX_OUTPUT_SIZE || quality <= 0.4) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              tryCompress(quality - 0.1);
            }
          },
          'image/jpeg',
          quality
        );
      };
      tryCompress(0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込みエラー')); };
    img.src = url;
  });
}

const ratingAxis = z.number().min(1, '評価を選択してください').max(5);

const reviewSchema = z.object({
  reviewer_name: z.string().min(1, 'お名前を入力してください'),
  rating_skill: ratingAxis,
  rating_service: ratingAxis,
  rating_atmosphere: ratingAxis,
  rating_cleanliness: ratingAxis,
  rating_explanation: ratingAxis,
  comment: z.string().max(500, '500文字以内で入力してください').optional().or(z.literal('')),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

const AXES = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '施術の説明' },
] as const;

interface Props {
  facilityId: string;
  facilitySlug?: string;
  facilityName?: string;
  onReviewSubmitted: () => void;
}

export default function ReviewForm({ facilityId, facilitySlug, facilityName, onReviewSubmitted }: Props) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting, isDirty }, reset } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      reviewer_name: '',
      rating_skill: 0,
      rating_service: 0,
      rating_atmosphere: 0,
      rating_cleanliness: 0,
      rating_explanation: 0,
      comment: '',
    },
  });

  useEffect(() => {
    if ((!isDirty && photos.length === 0) || submitted) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, photos.length, submitted]);

  // Cleanup blob URLs on unmount to prevent memory leaks
  const photoPreviewsRef = useRef(photoPreviews);
  photoPreviewsRef.current = photoPreviews;
  useEffect(() => {
    return () => { photoPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  const [compressing, setCompressing] = useState(false);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    let hasTypeError = false;
    let hasSizeError = false;
    const typeValid = files.filter((f) => {
      if (!ALLOWED_TYPES.includes(f.type)) { hasTypeError = true; return false; }
      if (f.size > MAX_FILE_SIZE) { hasSizeError = true; return false; }
      return true;
    });
    if (hasTypeError) { setToast({ type: 'error', message: 'JPEG/PNG/WebPのみ対応です' }); }
    if (hasSizeError) { setToast({ type: 'error', message: '10MB以下の画像を選択してください' }); }
    if (typeValid.length === 0) return;

    setCompressing(true);
    try {
      const compressed = await Promise.all(typeValid.map((f) => compressImage(f)));
      const combined = [...photos, ...compressed].slice(0, MAX_PHOTOS);
      // combined 全件分の blob URL を作り直すため、既存 previews の旧 URL を先に revoke する。
      // これを怠ると写真追加のたびに既存分の旧 URL が revoke されず、ドキュメント生存期間リークする。
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPhotos(combined);
      setPhotoPreviews(combined.map((f) => URL.createObjectURL(f)));
    } catch {
      setToast({ type: 'error', message: '画像の処理に失敗しました' });
    } finally {
      setCompressing(false);
    }
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: ReviewFormData) => {
    const sb = createBrowserSupabaseClient();

    try {
      // ログイン状態取得
      const { data: { user } } = await sb.auth.getUser();

      // Upload photos via Supabase Storage
      const photo_urls: string[] = [];
      if (photos.length > 0) {
        for (const file of photos) {
          const ext = file.name.split('.').pop() || 'jpg';
          const path = `reviews/${facilityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await sb.storage.from('review-photos').upload(path, file);
          if (!uploadErr) {
            const { data: urlData } = sb.storage.from('review-photos').getPublicUrl(path);
            photo_urls.push(urlData.publicUrl);
          }
        }
      }

      // reCAPTCHA v3 トークン取得（site key 設定時のみ実トークン・未設定の dev/CI では null）。
      // サーバ /api/review は secret 設定時に token を必須化（fail-closed）するため、ここで送らないと
      // 本番で全レビュー投稿が 403 になる。null の場合は従来通り token 無しで送る（secret 未設定環境）。
      const recaptchaToken = await getRecaptchaToken('review');

      // レビュー投稿はサーバーサイドAPIを経由（IP記録のため）
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'required' },
        body: JSON.stringify({
          facility_id: facilityId,
          reviewer_name: data.reviewer_name,
          rating_skill: data.rating_skill,
          rating_service: data.rating_service,
          rating_atmosphere: data.rating_atmosphere,
          rating_cleanliness: data.rating_cleanliness,
          rating_explanation: data.rating_explanation,
          comment: data.comment || null,
          photo_urls: photo_urls.length > 0 ? photo_urls : null,
          ...(recaptchaToken ? { recaptcha_token: recaptchaToken } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', message: body?.error || '送信に失敗しました' });
        return;
      }

      setSubmitted(true);
      setPhotos([]);
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPhotoPreviews([]);
      reset();
      onReviewSubmitted();
      setToast({ type: 'success', message: user ? '口コミを投稿しました（+50pt獲得！）' : '口コミを投稿しました' });
    } catch {
      setToast({ type: 'error', message: '送信に失敗しました。もう一度お試しください。' });
    }
  };

  if (submitted) {
    const facilityUrl = facilitySlug ? `https://carelink-jp.com/facility/${facilitySlug}` : '';
    const shareText = facilityName
      ? `${facilityName}の口コミを投稿しました！`
      : '施設の口コミを投稿しました！';
    const twitterUrl = facilityUrl
      ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(facilityUrl)}`
      : null;
    const lineUrl = facilityUrl
      ? `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(facilityUrl)}&text=${encodeURIComponent(shareText)}`
      : null;

    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-bold mb-1">口コミを投稿しました</p>
        <p className="text-gray-500 text-sm mb-5">ご投稿ありがとうございます。</p>
        {(twitterUrl || lineUrl) && (
          <div className="mb-5">
            <p className="text-xs text-gray-500 mb-2">SNSでシェアする</p>
            <div className="flex gap-2 justify-center">
              {twitterUrl && (
                <a
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-black text-white text-xs font-bold rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.836L1.254 2.25H8.08l4.259 5.626zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  X(Twitter)
                </a>
              )}
              {lineUrl && (
                <a
                  href={lineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#06C755] text-white text-xs font-bold rounded-lg hover:bg-[#05b34c] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                  LINE
                </a>
              )}
            </div>
          </div>
        )}
        <button type="button" onClick={() => router.refresh()} className="text-sky-600 text-sm hover:underline">
          ページを更新する
        </button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit(() => setShowConfirm(true))} noValidate className="space-y-4">
        <div>
          <label htmlFor="reviewer_name" className="form-label">お名前 <span className="text-red-500">*</span></label>
          <input {...register('reviewer_name')} id="reviewer_name" className="form-input" placeholder="ニックネーム可" autoComplete="name" aria-required="true" />
          {errors.reviewer_name && <p className="form-error" role="alert">{errors.reviewer_name.message}</p>}
        </div>

        <div>
          <p className="form-label">評価 <span className="text-red-500">*</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AXES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-gray-700 min-w-[5em]">{label}</span>
                <StarRating value={watch(key)} onChange={(v) => setValue(key, v, { shouldValidate: true })} size="sm" />
              </div>
            ))}
          </div>
          {(errors.rating_skill || errors.rating_service || errors.rating_atmosphere || errors.rating_cleanliness || errors.rating_explanation) && (
            <p className="form-error mt-1" role="alert">すべての項目を評価してください</p>
          )}
        </div>

        <div>
          <label htmlFor="review_comment" className="form-label">コメント</label>
          <textarea {...register('comment')} id="review_comment" className="form-input" rows={3} maxLength={500} placeholder="ご感想をお聞かせください（500文字以内）" />
          {errors.comment && <p className="form-error" role="alert">{errors.comment.message}</p>}
        </div>

        <div>
          <p className="form-label">写真（最大3枚）</p>
          <div className="flex gap-2 flex-wrap">
            {photoPreviews.map((url, i) => (
              <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`口コミ投稿用プレビュー写真${i + 1}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removePhoto(i)} aria-label={`写真${i + 1}を削除`} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center before:absolute before:-inset-2.5 before:content-['']">
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className={`w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center transition-colors ${compressing ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:border-sky-400'}`} aria-label="写真を追加">
                {compressing
                  ? <svg className="w-5 h-5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  : <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                }
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} disabled={compressing} className="hidden" aria-label="口コミ写真を選択" />
              </label>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">JPEG/PNG/WebP・最大10MB（自動圧縮されます）</p>
        </div>

        <button type="submit" disabled={isSubmitting || compressing} className="btn-primary w-full !py-3 text-sm">
          {isSubmitting ? '送信中...' : '口コミを投稿する'}
        </button>
      </form>

      <ConfirmDialog
        open={showConfirm}
        title="口コミを投稿しますか？"
        message="投稿後の編集・削除はできません。"
        confirmLabel="投稿する"
        cancelLabel="戻る"
        onConfirm={() => { if (isSubmitting) return; setShowConfirm(false); handleSubmit(onSubmit)(); }}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}
