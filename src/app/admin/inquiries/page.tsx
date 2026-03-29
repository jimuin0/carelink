import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';

export default async function AdminInquiriesPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, created_at, name, email, phone, inquiry_type, message')
    .order('created_at', { ascending: false })
    .limit(100);

  const items = contacts ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">お問い合わせ管理</h1>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">お問い合わせはまだありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <div key={c.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">{c.inquiry_type}</span>
                  <span className="text-xs text-gray-400">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              </div>
              <p className="font-bold text-sm">{c.name}</p>
              <p className="text-xs text-gray-500">{c.email}{c.phone ? ` / ${c.phone}` : ''}</p>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{c.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
