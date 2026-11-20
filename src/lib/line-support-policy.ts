import { z } from 'zod';
import { publicLineSupportAnswer, type LineSupportKnowledge } from './line-support-knowledge';

export type SupportMode = 'automatic' | 'human' | 'closed';
export type SupportInput = { text: string; type: 'text' | 'image' | 'file' | 'audio' | 'video' | 'sticker' | 'location'; source: 'user' | 'group' | 'room' };
export type SupportDecision =
  | { action: 'ignore'; reason: 'non_private_chat' }
  | { action: 'reply'; text: string; knowledgeRevision: string }
  | { action: 'draft'; reason: 'human_mode' | 'attachment' | 'no_verified_answer' };

/** Customer text never changes human/automatic mode. Only authenticated operator actions can. */
export function decideLineSupport(input: SupportInput, mode: SupportMode, knowledge: LineSupportKnowledge): SupportDecision {
  if (input.source !== 'user') return { action: 'ignore', reason: 'non_private_chat' };
  if (mode === 'human') return { action: 'draft', reason: 'human_mode' };
  if (input.type !== 'text') return { action: 'draft', reason: 'attachment' };
  const answer = publicLineSupportAnswer(input.text, knowledge);
  if (answer) return { action: 'reply', text: answer.text, knowledgeRevision: answer.knowledgeRevision };
  return { action: 'draft', reason: 'no_verified_answer' };
}

/** Generated content is an operator-only draft. It is never a customer reply command. */
export const lineSupportDraftSchema = z.object({
  text: z.string().trim().min(1).max(2400),
  missingInformation: z.array(z.string().trim().min(1).max(200)).max(5),
  sourceUrls: z.array(z.enum(['https://carelink-jp.com/register', 'https://carelink-jp.com/register/guide', 'https://carelink-jp.com/terms'])).max(3),
}).strict();

export type DraftEnvelope = {
  conversationId: string; conversationRevision: number; knowledgeRevision: string;
  recipientVersion: number; text: string;
};
export type DispatchState = {
  conversationId: string; conversationRevision: number; knowledgeRevision: string;
  recipientVersion: number; recipientVerified: boolean; operatorAllowed: boolean;
  deliveryState: 'pending' | 'accepted' | 'unknown' | 'failed';
};

/** Re-evaluate inside the DB delivery claim too; a stale draft must not be sent. */
export function canNotifyLineSupportDraft(draft: DraftEnvelope, current: DispatchState): boolean {
  return current.operatorAllowed && current.recipientVerified && current.deliveryState === 'pending'
    && draft.conversationId === current.conversationId
    && draft.conversationRevision === current.conversationRevision
    && draft.knowledgeRevision === current.knowledgeRevision
    && draft.recipientVersion === current.recipientVersion;
}

/** Notification preview contains the proposed text; original customer data stays in the console. */
export function formatLineSupportDraftNotice(caseReference: string, draft: z.infer<typeof lineSupportDraftSchema>): string {
  return `【CareLink 手動返信の文案】\n相談：${caseReference}\n次のメッセージがコピー用の返信文案です。\n\n運営の確認事項：${draft.missingInformation.join('／') || '管理画面で相談内容をご確認ください。'}\n\n運営向けの文案です。公式LINEの送信済み履歴と最新の追記を確認し、必要な内容だけ手動で返信してください。\nhttps://carelink-jp.com/admin/line-support?case=${encodeURIComponent(caseReference)}`;
}

/** 神原さんの Slack メンバーID（公開情報ではないが秘密値でもない）。通知のメンションに使う。 */
export const LINE_SUPPORT_SLACK_MENTION = 'U06NYJ30RFF';

/** Slack notice when no AI draft could be produced. Fixed text only: never customer data or model output. */
export function formatLineSupportFallbackNotice(caseReference: string, mentionUserId: string = LINE_SUPPORT_SLACK_MENTION): string {
  return `<@${mentionUserId}>\n*CareLink*\n新しい相談が届きました。\n返信案を自動作成できなかったため、管理画面で内容を確認して返信してください。\nhttps://carelink-jp.com/admin/line-support?case=${encodeURIComponent(caseReference)}`;
}
