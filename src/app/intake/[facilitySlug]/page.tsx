import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import IntakeForm from '@/components/intake/IntakeForm';
import { INTAKE_CUSTOMER_ENABLED } from '@/lib/intake-config';
import Link from 'next/link';
import Image from 'next/image';

export const revalidate = 0;

interface Props {
  params: Promise<{ facilitySlug: string }>;
  searchParams: Promise<{ booking_id?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facilitySlug } = await params;
  const supabase = createServerSupabaseClient();
  const { data: facility } = await supabase
    .from('facility_profiles')
    .select('name')
    .eq('slug', facilitySlug)
    .eq('status', 'published')
    .maybeSingle();

  return {
    title: `問診票 | ${facility?.name ?? '施設'}`,
    robots: { index: false, follow: false },
  };
}

export default async function IntakePage({ params, searchParams }: Props) {
  const { facilitySlug } = await params;
  const { booking_id } = await searchParams;

  // 【監査M2/H1・神原さん決定】ローンチでは問診機能を顧客に出さない（非表示）。
  // 既存の「現在ご利用いただけません」UX を再利用して graceful に閉じる（旧リンク経由の
  // アクセスにも配慮）。再開時は INTAKE_CUSTOMER_ENABLED を true に戻すだけでよい。
  if (!INTAKE_CUSTOMER_ENABLED) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 text-sm">この施設の問診票は現在ご利用いただけません。</p>
          <Link href={`/facility/${facilitySlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">
            施設ページに戻る
          </Link>
        </div>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: facility } = await supabase
    .from('facility_profiles')
    .select('id, name, slug, main_photo_url')
    .eq('slug', facilitySlug)
    .eq('status', 'published')
    .maybeSingle();

  if (!facility) notFound();

  const { data: template } = await supabase
    .from('intake_form_templates')
    .select('id, title, description, fields')
    .eq('facility_id', facility.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 text-sm">この施設の問診票は現在ご利用いただけません。</p>
          <Link href={`/facility/${facilitySlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">
            施設ページに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* 施設ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          {facility.main_photo_url && (
            <div className="relative w-10 h-10 rounded-full overflow-hidden shrink-0">
              <Image
                src={facility.main_photo_url}
                alt={facility.name}
                fill
                sizes="40px"
                className="object-cover"
              />
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">問診票</p>
            <p className="text-sm font-bold text-gray-800">{facility.name}</p>
          </div>
          <Link
            href={`/facility/${facilitySlug}`}
            className="ml-auto text-xs text-sky-600 hover:underline"
          >
            施設ページ →
          </Link>
        </div>

        <IntakeForm
          facilityId={facility.id}
          facilityName={facility.name}
          bookingId={booking_id}
          template={template}
        />
      </div>
    </div>
  );
}
