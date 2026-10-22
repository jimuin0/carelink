'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { verifyAuthUser } from '@/lib/auth-verification';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { SbInput, SbPageHeader } from '@/components/admin/SbUi';

const TAGS_EXAMPLE = ['ショートヘア', 'ボブ', 'カラー'].join('、');

export default function EditCatalogPage() {
  return <Suspense fallback={<AdminPageLoading />}><EditCatalogRoute /></Suspense>;
}

function EditCatalogRoute() {
  const requested = useSearchParams().get('facility_id');
  return <EditCatalogForm key={requested ?? 'unselected'} requested={requested} />;
}

function EditCatalogForm({ requested }: { requested: string | null }) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  // 編集先はカタログ自身の店舗（2026年10月22日）。一覧へ戻るときもその店舗のまま戻す。
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [choices, setChoices] = useState<AdminFacilityChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const identity = await verifyAuthUser(supabase.auth);
      if (identity.state !== 'verified') throw new Error('CATALOG_ACCESS_UNAVAILABLE');
      const { data, error } = await supabase
        .from('treatment_catalogs')
        .select('facility_id, title, description, tags')
        .eq('id', params.id)
        .maybeSingle();
      if (error || !data) throw new Error('CATALOG_READ_UNAVAILABLE');
      // カタログは公開読み取りできるため、自分の店舗（owner/admin）のものかをここで確かめる。
      // URL の店舗とカタログの店舗が食い違うときも扱わない（別の店舗の名前を出したまま保存させない）。
      const selection = await loadAdminFacilitySelection(supabase, identity.user.id, requested ?? data.facility_id);
      if (selection.selectedId !== data.facility_id) throw new Error('CATALOG_SCOPE_MISMATCH');
      if (cancelled) return;
      // 複数店舗で URL に店舗が無いとき（ブックマーク等）はカタログの店舗を URL に載せ、ヘッダーの店舗名と揃える。
      if (requested === null && selection.choices.length > 1) {
        router.replace(`/admin/catalog/${params.id}/edit?facility_id=${data.facility_id}`);
        return;
      }
      setChoices(selection.choices);
      setFacilityId(data.facility_id);
      setTitle(data.title ?? '');
      setDescription(data.description ?? '');
      setTags((data.tags ?? []).join(', '));
      setLoading(false);
    })().catch(() => { if (!cancelled) { setLoadError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [params.id, requested, reloadKey, router]);

  const listHref = `/admin/catalog?facility_id=${facilityId}`;

  const handleUpdate = async () => {
    if (saving || !title) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/catalog/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: title,
          description: description || null,
          tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
        }),
      });

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '更新に失敗しました' });
      } else {
        setDirty(false);
        router.push(listHref);
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setConfirmOpen(false);

    try {
      const res = await fetch(`/api/admin/catalog/${params.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '削除に失敗しました' });
        setDeleting(false);
      } else {
        router.push(listHref);
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
      setDeleting(false);
    }
  };

  if (loading) return <AdminPageLoading />;

  // 取得・所属の確認に失敗したらフォームを出さない（空のフォームや別の店舗のまま保存させない）
  if (loadError || !facilityId) {
    return (
      <div>
        <SbPageHeader title="カタログ編集" />
        <LoadError onRetry={() => { setLoadError(false); setLoading(true); setReloadKey((k) => k + 1); }} message="カタログの読み込みに失敗しました" />
      </div>
    );
  }

  return (
    <div onChange={() => setDirty(true)}>
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/catalog" dirty={dirty} busy={saving || deleting} />
      <SbPageHeader title="カタログ編集" />

      <div className="bg-white rounded-xl shadow-xs p-6 space-y-4">
        <div>
          <label htmlFor="catalog-title" className="form-label">タイトル <span className="text-red-500">*</span></label>
          <SbInput id="catalog-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label htmlFor="catalog-desc" className="form-label">説明</label>
          <textarea id="catalog-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="form-input" rows={3} maxLength={2000} />
        </div>
        <div>
          <label htmlFor="catalog-tags" className="form-label">タグ（カンマ区切り）</label>
          <SbInput id="catalog-tags" value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} title={TAGS_EXAMPLE} />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4">
          <p className="text-xs font-bold text-amber-800 mb-1">⚠️ 医療広告ガイドラインに関する注意</p>
          <p className="text-xs text-amber-700">
            Before/After写真を掲載する場合、施術内容・リスク・費用を明記し、「効果には個人差があります」等の注意書きを添える必要があります。
            誇大広告や虚偽広告は法律で禁止されています。
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <button type="button" onClick={() => router.push(listHref)} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleUpdate} disabled={saving} className="btn-primary flex-1 py-3!">
            {saving ? '保存中...' : '更新する'}
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} className="text-sm text-red-600 hover:underline">
            {deleting ? '削除中...' : '削除'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="カタログを削除"
        message="このカタログを削除しますか？"
        confirmLabel="削除する"
        variant="danger"
        confirmDisabled={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
