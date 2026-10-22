'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import JobForm from '@/components/admin/JobForm';
import Toast from '@/components/Toast';
import type { JobFormValues } from '@/lib/jobs';
import { SbPageHeader } from '@/components/admin/SbUi';
import FacilitySelector from '@/components/admin/FacilitySelector';
import AdminFacilityScope, { type AdminFacilityScopeValue } from '@/components/admin/AdminFacilityScope';

export default function NewJobPage() {
  return <AdminFacilityScope title="求人新規作成" path="/admin/jobs/new">{(scope) => <NewJobForm {...scope} />}</AdminFacilityScope>;
}

// 投稿先の店舗は AdminFacilityScope が ?facility_id= と所属から決める（2026年10月22日）。
// 以前は facility_id を送っていなかったため、複数店舗のオーナーは API が「投稿先の施設を指定してください」
// （400）を返し、どの店舗の求人も作れなかった。JobForm の値は zod が未知のキーを落とすので、ここで付け足す。
function NewJobForm({ facilityId, choices }: AdminFacilityScopeValue) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async (values: JobFormValues) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, facility_id: facilityId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: json.error || '作成に失敗しました' });
        return;
      }
      setDirty(false);
      router.push('/admin/jobs');
      router.refresh();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div onChange={() => setDirty(true)}>
      <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/jobs/new" dirty={dirty} busy={submitting} />
      <SbPageHeader title="求人新規作成" />
      <JobForm
        submitLabel="求人を作成"
        submitting={submitting}
        onSubmit={handleCreate}
        onCancel={() => router.push('/admin/jobs')}
      />
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
