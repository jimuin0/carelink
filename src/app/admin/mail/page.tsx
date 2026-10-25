import MailConsole from '@/components/admin/MailConsole';
import { UUID_REGEX } from '@/lib/constants';

export const metadata = { title: 'メール' };
export default async function MailPage({ searchParams }: { searchParams: Promise<{ contactId?: string }> }) {
  const { contactId } = await searchParams;
  return <MailConsole initialContactId={contactId && UUID_REGEX.test(contactId) ? contactId : undefined} />;
}
