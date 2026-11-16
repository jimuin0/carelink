import { chatDailyLimit } from './chat-rate-limit';
import { isLineSupportQueueConfigured } from '@/lib/line-support-wakeup';
import type { z } from 'zod';
import type { supportReadinessSchema } from './line-support-contract';

/** Presence checks only: no secret values leave this server-side boundary. */
export function lineSupportReadiness(): z.infer<typeof supportReadinessSchema> {
  const present = (value: string | undefined) => Boolean(value?.trim());
  const checks = {
    enabled: process.env.LINE_SUPPORT_ENABLED === 'true',
    line: present(process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK)
      && present(process.env.LINE_CHANNEL_SECRET_CARELINK)
      && /^U[0-9a-f]{32}$/.test(process.env.LINE_SUPPORT_DESTINATION ?? ''),
    drafts: present(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY)
      && present(process.env.LINE_SUPPORT_CLAUDE_MODEL || process.env.CLAUDE_MODEL),
    quota: chatDailyLimit(process.env.AI_CHAT_DAILY_REQUEST_LIMIT) !== null,
    processing: present(process.env.CRON_SECRET) && isLineSupportQueueConfigured(),
    version: /^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
  };
  const missing = (Object.keys(checks) as (keyof typeof checks)[]).filter(key => !checks[key]);
  return { configured: missing.length === 0, missing };
}
