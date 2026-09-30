import { salonInsertSchema } from './validations';
import { extractCity, extractPrefecture } from './japan-address';

// Changing normalization requires a new version, never silently reinterpreting
// an already committed intent. This module has no persistence or I/O.
export const SALON_CANONICAL_VERSION = 1;

/** Parse and canonicalize only saved business fields, not captcha/transport state. */
export function canonicalSalonSubmission(input: unknown) {
  const parsed = salonInsertSchema.safeParse(input);
  if (!parsed.success) return null;
  const d = parsed.data;
  const photoUrls = (d.photo_urls ?? []).filter(Boolean);
  const row = {
    facility_name: d.facility_name,
    business_type: d.business_type,
    representative_name: d.representative_name,
    contact_name: d.contact_name,
    email: d.email.toLowerCase(),
    // phoneField's shared return type also includes its optional mode, but the
    // salon schema above invokes required:true and rejects null/undefined.
    phone: d.phone!.replace(/-/g, ''),
    contact_phone: d.contact_phone?.replace(/-/g, '') || null,
    website: d.website || null,
    postal_code: d.postal_code?.replace(/-/g, '') || null,
    address: d.address || null,
    prefecture: d.prefecture || extractPrefecture(d.address) || null,
    city: d.city || extractCity(d.address) || null,
    building_name: d.building_name || null,
    nearest_station: d.nearest_station || null,
    business_hours: d.business_hours || null,
    regular_holiday: d.regular_holiday || null,
    seat_count: d.seat_count ?? null,
    staff_count: d.staff_count ?? null,
    has_parking: d.has_parking ?? false,
    features: d.features ?? [],
    pr_text: d.pr_text || null,
    photo_url: photoUrls[0] || null,
    photo_urls: photoUrls,
    desired_start_date: d.desired_start_date || null,
    source: d.source,
  };
  // Fixed property order; array order remains meaningful (especially photo slots).
  return { row, serialized: JSON.stringify({ version: SALON_CANONICAL_VERSION, row }) };
}
