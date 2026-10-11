import { UUID_REGEX } from './constants';

/** Persist only the operation UUID, never staff input. A reload resolves this
 * receipt before displaying the form; storage failure blocks a non-recoverable write. */
export function staffOperationKey(actor: string, facility: string, staff = 'new'): string {
  return `carelink-staff-operation:${actor}:${facility}:${staff}`;
}
export function pendingStaffOperation(key: string): string | null {
  const id = sessionStorage.getItem(key);
  if (id !== null && !UUID_REGEX.test(id)) throw new Error('Invalid pending operation');
  return id;
}
export function beginStaffOperation(key: string): string {
  const prior = pendingStaffOperation(key);
  if (prior !== null) return prior;
  const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id;
}
export function finishStaffOperation(key: string): void { sessionStorage.removeItem(key); }
export async function recoverStaffOperation(key: string, facility: string, staff?: string): Promise<'absent' | 'saved' | 'retired'> {
  const operation = pendingStaffOperation(key);
  if (operation === null) return 'absent';
  const query = new URLSearchParams({ facility_id: facility, operation_id: operation, kind: staff === undefined ? 'create' : 'weekly' });
  if (staff !== undefined) query.set('staff_id', staff);
  const res = await fetch(`/api/admin/staff?${query.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Operation recovery unavailable');
  const data = await res.json();
  if (!['absent', 'saved', 'retired'].includes(data?.state)) throw new Error('Invalid operation recovery');
  finishStaffOperation(key); return data.state;
}
