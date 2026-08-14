export const meta = {
  name: 'sorter-worker-judge',
  description: 'Haiku sorts a task batch into worker-sized groups, Sonnet workers implement each group in parallel, Opus independently judges and can bounce work back for rework.',
  phases: [
    { title: 'Sort', detail: 'Haiku groups tasks and writes a self-contained brief per group', model: 'haiku' },
    { title: 'Work', detail: 'Sonnet workers implement each group, up to maxWorkers in parallel', model: 'sonnet' },
    { title: 'Judge', detail: 'Opus independently verifies each result against its acceptance criteria', model: 'opus' },
  ],
}

// Generic 3-tier cost/quality pipeline. Do not hardcode project-specific values here —
// pass them through `args` (see SKILL.md "customization points"). Keeping this file
// project-agnostic is what makes it safe to copy into any repo unchanged.

const MAX_WORKERS = (args && args.maxWorkers) || 8
const MAX_RETRIES = (args && args.maxRetries) != null ? args.maxRetries : 2
const TASKS = (args && args.tasks) || []
const CONTEXT = (args && args.context) || ''

if (!TASKS.length) {
  throw new Error('args.tasks is empty — pass an array of task descriptions to sort.')
}

const SORT_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short slug, unique within this run' },
          task_indices: { type: 'array', items: { type: 'integer' }, description: 'indices into the original task list this group covers' },
          brief: {
            type: 'string',
            description: 'self-contained instructions for a worker with zero memory of this conversation: exactly what to change, where, and any constraints',
          },
          acceptance_criteria: {
            type: 'array',
            items: { type: 'string' },
            description: 'concrete, independently checkable statements — these are what the judge verifies, not what the worker claims',
          },
          touches_shared_files: {
            type: 'boolean',
            description: 'true if this group edits files/resources another group also touches, or anything project rules mark as shared/high-risk — triggers worktree isolation',
          },
          risk_notes: { type: 'string' },
        },
        required: ['id', 'task_indices', 'brief', 'acceptance_criteria', 'touches_shared_files'],
      },
    },
    escalate: {
      type: 'array',
      description: 'tasks too ambiguous, high-risk, or judgment-heavy for an automated worker/judge pass — hand these to the human instead of routing them',
      items: {
        type: 'object',
        properties: {
          task_index: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['task_index', 'reason'],
      },
    },
  },
  required: ['groups', 'escalate'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    verified_against_criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string', description: 'what you actually looked at to decide this — not a restatement of the worker\'s claim' },
        },
        required: ['criterion', 'met', 'evidence'],
      },
    },
    rejection_reason: { type: 'string', description: 'required when approved=false; specific enough for a worker to act on' },
  },
  required: ['approved', 'verified_against_criteria'],
}

phase('Sort')
log(`Sorting ${TASKS.length} task(s) into worker-sized groups (max ${MAX_WORKERS} concurrent workers)...`)

const numberedTasks = TASKS.map((t, i) => `[${i}] ${t}`).join('\n')
const sortResult = await agent(
  `You are triaging a batch of engineering tasks for a build pipeline that hands each group to a fresh worker and then to an independent reviewer.

Group related or conflicting tasks together (same files, same feature) so one worker owns the whole group — never split tasks that touch the same file across two groups. Keep genuinely independent tasks in separate single-task groups so they can run in parallel; don't merge unrelated tasks just to reduce the group count.

Each group's brief must be self-contained: the worker who receives it has no memory of this conversation, so include the exact context, constraints, and file paths it needs. Write concrete, independently checkable acceptance_criteria per group — a separate reviewer will verify against these, not against whatever the worker later claims, so vague criteria like "works correctly" are useless.

Set touches_shared_files=true for anything touching shared config, schemas, shared utilities, auth, or anything the project context below calls out as shared/high-risk.

Put anything too ambiguous, high-risk, or judgment-heavy for an automated pass into escalate instead of a group — do not force a risky or unclear task into a group just to keep coverage complete.

${CONTEXT ? `Project context:\n${CONTEXT}\n\n` : ''}Tasks:\n${numberedTasks}`,
  { model: 'haiku', phase: 'Sort', schema: SORT_SCHEMA }
)

if (sortResult.escalate && sortResult.escalate.length) {
  log(`${sortResult.escalate.length} task(s) escalated to human by the sorter — too risky/ambiguous for automated routing`)
}

const groups = sortResult.groups || []
log(`Sorted into ${groups.length} group(s)`)

async function runGroup(group) {
  let feedback = ''
  let lastWorkerReport = null
  let lastVerdict = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const workerPrompt = `Implement the following task. Report exactly what you changed (files touched, summary of the diff) and flag any uncertainty explicitly — a separate reviewer will independently verify your work against the acceptance criteria below, so do not just assert success without describing what you actually did.

Brief:
${group.brief}

Acceptance criteria:
${(group.acceptance_criteria || []).map(c => `- ${c}`).join('\n')}
${feedback ? `\nA previous attempt was rejected by the reviewer. Fix this before anything else:\n${feedback}\n` : ''}`

    lastWorkerReport = await agent(workerPrompt, {
      model: 'sonnet',
      phase: 'Work',
      label: `work:${group.id}`,
      isolation: group.touches_shared_files ? 'worktree' : undefined,
    })

    lastVerdict = await agent(
      `You are an independent reviewer for a finished piece of work. Do not trust the worker's self-report — verify each acceptance criterion yourself against the actual result (read the relevant files/diff, run checks if applicable). Reject if any criterion is unmet, if the evidence is too thin to confirm, or if the worker's report doesn't actually demonstrate the criterion was checked.

Brief given to the worker:
${group.brief}

Acceptance criteria:
${(group.acceptance_criteria || []).map(c => `- ${c}`).join('\n')}

Worker's report:
${lastWorkerReport}`,
      { model: 'opus', phase: 'Judge', label: `judge:${group.id}`, schema: VERDICT_SCHEMA }
    )

    if (lastVerdict && lastVerdict.approved) {
      log(`✅ ${group.id} approved${attempt > 0 ? ` (after ${attempt} rework round(s))` : ''}`)
      return { group, approved: true, attempts: attempt + 1, report: lastWorkerReport, verdict: lastVerdict }
    }

    feedback = (lastVerdict && lastVerdict.rejection_reason) || 'Judge rejected without a stated reason — re-check every acceptance criterion from scratch.'
    if (attempt < MAX_RETRIES) {
      log(`↩️ ${group.id} sent back to worker (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${feedback}`)
    }
  }

  log(`🔴 ${group.id} still failing after ${MAX_RETRIES} rework round(s) — escalating to human`)
  return { group, approved: false, attempts: MAX_RETRIES + 1, report: lastWorkerReport, verdict: lastVerdict }
}

phase('Work')
const results = []
for (let i = 0; i < groups.length; i += MAX_WORKERS) {
  const wave = groups.slice(i, i + MAX_WORKERS)
  log(`Running wave of ${wave.length} worker(s) (groups ${i + 1}-${i + wave.length} of ${groups.length})`)
  const waveResults = await parallel(wave.map(g => () => runGroup(g)))
  results.push(...waveResults.filter(Boolean))
}

const approvedResults = results.filter(r => r.approved)
const failedResults = results.filter(r => !r.approved)

log(`Done: ${approvedResults.length}/${results.length} group(s) approved, ${failedResults.length} need human attention, ${(sortResult.escalate || []).length} escalated before work began`)

return {
  approved: approvedResults.map(r => ({ id: r.group.id, task_indices: r.group.task_indices, attempts: r.attempts, report: r.report })),
  failed: failedResults.map(r => ({ id: r.group.id, task_indices: r.group.task_indices, attempts: r.attempts, last_rejection: r.verdict && r.verdict.rejection_reason })),
  escalated_by_sorter: sortResult.escalate || [],
  summary: `${approvedResults.length}/${results.length} group(s) approved, ${failedResults.length} need human attention, ${(sortResult.escalate || []).length} escalated before work began`,
}
