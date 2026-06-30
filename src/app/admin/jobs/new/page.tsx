'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import JobForm from '@/components/admin/JobForm';
import Toast from '@/components/Toast';
import type { JobFormValues } from '@/lib/jobs';
import { SbPageHeader } from '@/components/admin/SbUi';

export default function NewJobPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleCreate = async (values: JobFormValues) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: json.error || '作成に失敗しました' });
        return;
      }
      router.push('/admin/jobs');
      router.refresh();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
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
