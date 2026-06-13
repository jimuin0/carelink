'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import type { FacilityPhoto } from '@/types';

const photoTypes: { value: FacilityPhoto['photo_type']; label: string }[] = [
  { value: 'main', label: 'メイン' },
  { value: 'interior', label: '内観' },
  { value: 'exterior', label: '外観' },
  { value: 'staff', label: 'スタッフ' },
  { value: 'menu', label: 'メニュー' },
  { value: 'other', label: 'その他' },
];

export default function AdminPhotosPage() {
  const [photos, setPhotos] = useState<FacilityPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Upload form
  const [selectedType, setSelectedType] = useState<FacilityPhoto['photo_type']>('interior');
  const [caption, setCaption] = useState('');

  const loadPhotos = useCallback(async (fId: string) => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data, error } = await supabase
      .from('facility_photos')
      .select('*')
      .eq('facility_id', fId)
      .order('sort_order', { ascending: true })
      .limit(100);
    if (error) { setLoadError(true); return; }
    setPhotos((data ?? []) as FacilityPhoto[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      await loadPhotos(membership.facility_id);
      setLoading(false);
    };
    init().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadPhotos]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !facilityId || uploading) return;

    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setToast({ type: 'error', message: 'JPG, PNG, WebPのみ対応しています' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast({ type: 'error', message: 'ファイルサイズは5MB以下にしてください' });
      return;
    }

    setUploading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `facilities/${facilityId}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);

      const { error: insertError } = await supabase
        .from('facility_photos')
        .insert({
          facility_id: facilityId,
          photo_url: urlData.publicUrl,
          photo_type: selectedType,
          caption: caption.trim() || null,
          sort_order: photos.length,
        });

      if (insertError) throw insertError;

      setToast({ type: 'success', message: 'アップロードしました' });
      setCaption('');
      await loadPhotos(facilityId);
    } catch {
      setToast({ type: 'error', message: 'アップロードに失敗しました' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = (photo: FacilityPhoto) => {
    if (!facilityId || deleting) return;
    setConfirmDeleteId(photo.id);
  };

  const executeDelete = async () => {
    const id = confirmDeleteId;
    if (!id || !facilityId) return;
    setConfirmDeleteId(null);
    setDeleting(id);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('facility_photos')
        .delete()
        .eq('id', id)
        .eq('facility_id', facilityId);
      if (error) throw error;
      setToast({ type: 'success', message: '削除しました' });
      await loadPhotos(facilityId);
    } catch {
      setToast({ type: 'error', message: '削除に失敗しました' });
    } finally {
      setDeleting(null);
    }
  };

  const setAsMain = async (photo: FacilityPhoto) => {
    if (!facilityId) return;
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase
        .from('facility_profiles')
        .update({ main_photo_url: photo.photo_url, updated_at: new Date().toISOString() })
        .eq('id', facilityId);
      setToast({ type: 'success', message: 'メイン写真を設定しました' });
    } catch {
      setToast({ type: 'error', message: '設定に失敗しました' });
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <div key={i} className="aspect-square bg-gray-200 rounded-xl" />)}</div>
      </div>
    );
  }

  const grouped = photoTypes.map((pt) => ({
    ...pt,
    items: photos.filter((p) => p.photo_type === pt.value),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">写真管理</h1>

      {/* 医療広告ガイドライン注意書き */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
        <p className="font-bold mb-1">⚠️ 医療広告ガイドラインについて</p>
        <p>施術前後の比較（Before/After）写真は、<strong>医療広告ガイドライン</strong>により表示が制限される場合があります。鍼灸院・整骨院・クリニック等は特定の条件を満たさない限り掲載をお控えください。詳細は<a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/koukoku/index.html" target="_blank" rel="noopener noreferrer" className="underline">厚生労働省のガイドライン</a>をご確認ください。</p>
      </div>

      {/* アップロード */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-bold mb-4">写真をアップロード</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="photo-type" className="form-label">種類</label>
            <select id="photo-type" value={selectedType} onChange={(e) => setSelectedType(e.target.value as FacilityPhoto['photo_type'])} className="form-input">
              {photoTypes.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="photo-caption" className="form-label">キャプション（任意）</label>
            <input id="photo-caption" value={caption} onChange={(e) => setCaption(e.target.value)} className="form-input" maxLength={200} placeholder="写真の説明" />
          </div>
          <label className={`btn-primary !py-2.5 px-6 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploading ? 'アップロード中...' : '写真を選択'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-2">JPG, PNG, WebP / 最大5MB</p>
      </div>

      {/* 写真一覧 */}
      {loadError ? (
        <LoadError onRetry={() => { if (facilityId) loadPhotos(facilityId); }} message="写真の読み込みに失敗しました" />
      ) : photos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400">写真がまだ登録されていません</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ value, label, items }) => (
            <section key={value}>
              <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{label}（{items.length}枚）</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((photo) => (
                  <div key={photo.id} className="group relative bg-white rounded-xl shadow-sm overflow-hidden">
                    <div className="relative aspect-square">
                      <Image src={photo.photo_url} alt={photo.caption || label} fill className="object-cover" sizes="(max-width: 640px) 50vw, 25vw" />
                    </div>
                    {photo.caption && (
                      <p className="text-xs text-gray-500 p-2 truncate">{photo.caption}</p>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setAsMain(photo)}
                        className="px-3 py-1.5 bg-white text-gray-800 text-xs font-bold rounded-lg hover:bg-sky-50"
                      >
                        メインに設定
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(photo)}
                        disabled={deleting === photo.id}
                        className="px-3 py-1.5 bg-white text-red-600 text-xs font-bold rounded-lg hover:bg-red-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="写真を削除"
        message="この写真を削除しますか？削除すると元に戻せません。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
        onConfirm={executeDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
