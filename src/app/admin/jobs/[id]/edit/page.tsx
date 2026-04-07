'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import JobForm from '@/components/admin/JobForm';
import Toast from '@/components/Toast';
import type { JobFormInput, JobFormValues } from '@/lib/jobs';

export default function EditJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [defaults, setDefaults] = useState<Partial<JobFormInput> | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, { cache: 'no-store' });
      if (!res.ok) {
        router.push('/admin/jobs');
        return;
      }
      const { job } = await res.json();
      setDefaults({
        title: job.title ?? '',
        job_type: job.job_type ?? '',
        employment_type: job.employment_type ?? '正社員',
        salary_min: job.salary_min ?? '',
        salary_max: job.salary_max ?? '',
        salary_note: job.salary_note ?? '',
        description: job.description ?? '',
        requirements: job.requirements ?? '',
        benefits: job.benefits ?? '',
      });
    } finally {
      setLoading(false);
    }
  }, [jobId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (values: JobFormValues) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: json.error || '保存に失敗しました' });
        return;
      }
      setToast({ type: 'success', message: '保存しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('この求人を削除しますか？')) return;
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: json.error || '削除に失敗しました' });
        return;
      }
      router.push('/admin/jobs');
      router.refresh();
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">求人編集</h1>
      {loading || !defaults ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">読み込み中...</div>
      ) : (
        <JobForm
          defaultValues={defaults}
          submitLabel="保存"
          submitting={submitting}
          onSubmit={handleSave}
          onCancel={() => router.push('/admin/jobs')}
          onDelete={handleDelete}
        />
      )}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
