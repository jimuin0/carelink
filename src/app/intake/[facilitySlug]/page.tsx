import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import IntakeForm from '@/components/intake/IntakeForm';
import { INTAKE_CUSTOMER_ENABLED } from '@/lib/intake-config';
import type { Json } from '@/types/database.types';
import Link from 'next/link';
import Image from 'next/image';

export const revalidate = 0;

// intake_form_templates.fields は JSONB NOT NULL DEFAULT '[]'（migration 20260417000019）で、
// コメントに書かれた構造 [{ id, type, label, required, options?, placeholder? }] は DB 側の
// 制約では強制されていない（管理画面からの書込経路が現状なく、SQL による手動投入のみ）ため、
// Database 型では Json のまま（IntakeForm が要求する FormField[] を型として保証できない）。
// IntakeForm 自身も Array.isArray(template.fields) までしか防御しておらず、個々の要素の
// 形は無検証で type/label/required 等をそのまま参照している。ここで各要素の形を検証し、
// 要件を満たさない要素は落とす（不正な要素を渡すとフォームの描画・必須チェックが壊れるため、
// IntakeForm の防御方針を一段深くする形の安全側の実装＝型を配線したことで露見した潜在バグ）。
type IntakeFieldType = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'boolean';
const INTAKE_FIELD_TYPES = new Set<string>(['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'boolean']);

interface IntakeFormField {
  id: string;
  type: IntakeFieldType;
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

function isIntakeFieldType(v: unknown): v is IntakeFieldType {
  return typeof v === 'string' && INTAKE_FIELD_TYPES.has(v);
}

function toStringArray(v: Json | undefined): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const result: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return undefined;
    result.push(item);
  }
  return result;
}

function toIntakeFormFields(fields: Json): IntakeFormField[] {
  if (!Array.isArray(fields)) return [];
  const result: IntakeFormField[] = [];
  for (const item of fields) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const { id, type, label, required, options, placeholder } = item;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof required !== 'boolean' || !isIntakeFieldType(type)) {
      continue;
    }
    const field: IntakeFormField = { id, type, label, required };
    const normalizedOptions = toStringArray(options);
    if (normalizedOptions) field.options = normalizedOptions;
    if (typeof placeholder === 'string') field.placeholder = placeholder;
    result.push(field);
  }
  return result;
}

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
          template={{
            id: template.id,
            title: template.title,
            description: template.description,
            fields: toIntakeFormFields(template.fields),
          }}
        />
      </div>
    </div>
  );
}
