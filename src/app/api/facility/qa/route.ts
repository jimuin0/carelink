import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { withRoute, serverError } from '@/lib/with-route';
import { runAfterResponse } from '@/lib/after-response';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { notifyFacilityOfNewQuestion } from '@/lib/facility-question-notification';
import { FACILITY_QA_QUESTION_MAX_LENGTH, FACILITY_QA_QUESTION_LENGTH_MESSAGE } from '@/lib/facility-qa-limits';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// POST /api/facility/qa : 施設 Q&A への質問の唯一の登録経路（2026年10月22日）。
//
// 【それまでの状態】QASection.tsx がブラウザから facility_qa へ直接 INSERT していた。
//   1. RLS が status / answer / is_public を縛っておらず、ログインした人なら誰でも
//      「施設の回答」付きで公開済みの Q&A を作れた（施設名義の偽回答）。
//   2. 保存されるだけで店舗に何も届かず、店舗が /admin/qa を自分で開くまで放置された。
// 【この経路】保存する値はサーバーが決める（質問者＝ログイン中の本人・status='pending'・
//   回答なし）。クライアントから受け取るのは施設と質問文だけ。保存できたら、その店舗の
//   owner / admin へ応答後にメールで知らせる。ブラウザからの書き込みは migration
//   20261022150100（列と WITH CHECK を絞る）→ 20261022150300（INSERT 権の撤回）で閉じる。
//
// is_public=true は「店舗が回答したら公開する」という意味（従来の QASection と同じ）。
// 公開読みのポリシーは status='answered' を条件にしているので、回答待ちの間は誰にも見えない。
// 回答は /api/admin/qa（service_role の manage_admin_content_atomic）からだけ書ける。
// -----------------------------------------------------------------------------

const questionSchema = z.object({
  facility_id: z.string().uuid(),
  question: z.string().trim().min(1).max(FACILITY_QA_QUESTION_MAX_LENGTH),
});

/** 1 アカウントあたりの質問数の上限（店舗への通知メールを連投させないため）。 */
const PER_USER_LIMIT = 10;
const PER_USER_WINDOW_MS = 60 * 60_000;

export const POST = withRoute(async (request, ctx) => {
  const userId = ctx.user!.id;
  if (await checkRateLimit(mutationRateLimit, userId, PER_USER_LIMIT, PER_USER_WINDOW_MS, 'facility-qa-user')) {
    return NextResponse.json({ error: '質問の投稿が続いています。しばらくしてからお試しください。' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = questionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: FACILITY_QA_QUESTION_LENGTH_MESSAGE }, { status: 400 });
  }
  const d = parsed.data;

  const db = createServiceRoleClient();
  const { data: facility, error: facilityError } = await db
    .from('facility_profiles')
    .select('id, name')
    .eq('id', d.facility_id)
    .eq('status', 'published')
    .maybeSingle();
  if (facilityError) return serverError('facility-qa-facility-lookup', databaseDiagnostic(facilityError), '/api/facility/qa');
  if (!facility) return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });

  const { data: created, error: insertError } = await db
    .from('facility_qa')
    .insert({
      facility_id: facility.id,
      user_id: userId,
      question: d.question,
      status: 'pending',
      is_public: true,
    })
    .select('id')
    .single();
  if (insertError || !created) {
    return serverError(
      'facility-qa-insert',
      insertError ? databaseDiagnostic(insertError) : new Error('facility_qa insert returned no row'),
      '/api/facility/qa',
      '質問の送信に失敗しました。時間をおいて再度お試しください。',
    );
  }

  // 応答を遅らせずに、完了まで実行させる（サーバーレスの凍結で通知が消えないように）。
  runAfterResponse(() => notifyFacilityOfNewQuestion({
    facilityId: facility.id,
    facilityName: facility.name,
    question: d.question,
  }));

  return NextResponse.json({ success: true, id: created.id }, { status: 201 });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'facility-qa' },
  sentryTag: 'facility-qa',
});
