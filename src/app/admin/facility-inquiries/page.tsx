'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';
import AdminPageLoading from '@/components/admin/AdminPageLoading';

interface FacilityInquiry {
  id: string;
  created_at: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminFacilityInquiriesPage() {
  const [inquiries, setInquiries] = useState<FacilityInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadInquiries = useCallback(async (facilityId: string) => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    // RLS(facility_inquiries_member_read)が facility_members(owner/admin)にスコープ済みのため
    // 認証済みクライアントからの直接読み取りで安全（他施設の問い合わせは行レベルで遮断される）。
    const { data, error } = await supabase
      .from('facility_inquiries')
      .select('id, created_at, name, email, phone, message')
      .eq('facility_id', facilityId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { setLoadError(true); return; }
    setInquiries((data ?? []) as FacilityInquiry[]);
  }, []);

  // user→membership→facilityId→一覧取得 の全工程。リトライ時も facilityId を再導出するため
  // 完全再取得をこの単一関数に集約する（admin/qa と同型パターン）。
  const reload = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: membership, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id)
      .in('role', ['owner', 'admin']).limit(1).single();
    if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
    if (!membership) { setLoading(false); return; }
    await loadInquiries(membership.facility_id);
    setLoading(false);
  }, [loadInquiries]);

  useEffect(() => {
    reload().catch(() => { setLoadError(true); setLoading(false); });
  }, [reload]);

  if (loading) return <AdminPageLoading />;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <SbPageHeader title="問い合わせ" />

      {loadError ? (
        <LoadError onRetry={() => { reload().catch(() => { setLoadError(true); setLoading(false); }); }} message="問い合わせの読み込みに失敗しました" />
      ) : inquiries.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400">お問い合わせはまだありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {inquiries.map((inq) => (
            <div key={inq.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(expandedId === inq.id ? null : inq.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs text-gray-400">{formatDate(inq.created_at)}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 truncate">{inq.name}</p>
                  <p className="text-xs text-gray-500">{inq.email}{inq.phone ? ` / ${inq.phone}` : ''}</p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform ${expandedId === inq.id ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {expandedId === inq.id && (
                <div className="border-t border-gray-100 p-4 space-y-4">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{inq.message}</p>
                  <a
                    href={`mailto:${inq.email}?subject=Re: お問い合わせの件&body=%0A%0A--- 元のメッセージ ---%0A${encodeURIComponent(inq.message)}`}
                    className="btn-primary gap-1.5 text-sm !px-4 !py-2 inline-flex"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    メールで返信
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
