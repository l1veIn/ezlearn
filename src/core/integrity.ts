import { z } from 'zod';
import {
  AppError,
  emptyState,
  fail,
  idSchema,
  kindSchema,
  materialSchema,
  questionSchema,
  type State,
} from '../contracts/index.js';
import { validatePack, validateQuestionReferences } from './pack.js';
import { rebuildProgress } from './progress.js';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
export async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
const iso = z.string().datetime();
const rec = z.record(z.string().max(300), z.unknown());
const rootSchema = z
  .object({
    schema_version: z.literal(1),
    packs: rec,
    goals: rec,
    lessons: rec,
    attempts: rec,
    reviews: rec,
    progress: rec,
    evidence: rec,
  })
  .strict();
const goalSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(300),
    pack_id: idSchema,
    pack_version: z.string(),
    daily_minutes: z.number().int().min(5).max(60),
    exam_date: z.iso.date().optional(),
    level: z.string(),
    active: z.boolean(),
    created_at: iso,
  })
  .strict();
const packVersionSchema = z
  .object({
    id: idSchema,
    version: z.string(),
    pack: z.unknown(),
    checksum: z.string(),
    source: z
      .object({
        kind: z.enum(['local', 'github', 'import']),
        url: z.string().optional(),
        ref: z.string().optional(),
        resolved: z.string().optional(),
      })
      .strict(),
    installed_at: iso,
  })
  .strict();
const envelope = z
  .object({
    format: z.literal('ezlearn-export'),
    version: z.literal(1),
    exported_at: iso,
    source_revision: z.number().int().nonnegative(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    data: rootSchema,
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const nonempty = z.string().min(1).max(20000);
const key = z.string().min(1).max(200);
const gradeSchema = z
  .object({ question_id: idSchema, score: z.number().min(0).max(100), feedback: nonempty })
  .strict();
const lessonSchema = z
  .object({
    id: idSchema,
    goal_id: idSchema,
    pack_id: idSchema,
    pack_version: z.string(),
    title: nonempty,
    objective: nonempty,
    explanation: nonempty,
    example: nonempty,
    context_summary: z.string().max(3000),
    topic_ids: z.array(idSchema).min(1),
    kind: kindSchema,
    minutes: z.number().int().min(5).max(60),
    status: z.enum(['draft', 'published']),
    questions: z.array(questionSchema).min(1).max(30),
    materials: z.array(materialSchema),
    created_at: iso,
    published_at: iso.optional(),
    idempotency_key: key,
    request_hash: hash,
    blueprint_id: idSchema.optional(),
  })
  .strict();
const attemptSchema = z
  .object({
    id: idSchema,
    lesson_id: idSchema,
    goal_id: idSchema,
    status: z.enum(['in_progress', 'submitted', 'reviewed']),
    version: z.number().int().nonnegative(),
    answers: z.record(idSchema, z.string().max(10000)),
    created_at: iso,
    submitted_at: iso.optional(),
    idempotency_key: key,
  })
  .strict();
const revisionSchema = z
  .object({
    version: z.number().int().positive(),
    grades: z.array(gradeSchema),
    total: z.number().nonnegative(),
    summary: nonempty,
    next_steps: nonempty,
    reason: nonempty,
    replaced_at: iso,
  })
  .strict();
const reviewSchema = z
  .object({
    id: idSchema,
    attempt_id: idSchema,
    version: z.number().int().positive(),
    grades: z.array(gradeSchema).min(1),
    total: z.number().nonnegative(),
    max_score: z.number().positive(),
    summary: nonempty,
    next_steps: nonempty,
    created_at: iso,
    idempotency_key: key,
    request_hash: hash,
    revisions: z.array(revisionSchema),
  })
  .strict();
export type ExportBundle = {
  format: 'ezlearn-export';
  version: 1;
  exported_at: string;
  source_revision: number;
  checksum: string;
  data: State;
};
const check = (valid: unknown, message: string) => {
  if (!valid) fail('INVALID_IMPORT', message);
};
export function counts(state: State) {
  return Object.fromEntries(
    Object.keys(emptyState())
      .filter((k) => k !== 'schema_version')
      .map((k) => [k, Object.keys(state[k as Exclude<keyof State, 'schema_version'>]).length]),
  );
}
export async function validateBundle(input: unknown): Promise<ExportBundle> {
  try {
    return await validateBundleInternal(input);
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail(
      'INVALID_IMPORT',
      '迁移实体格式或引用不正确',
      400,
      error instanceof z.ZodError ? error.issues : undefined,
    );
  }
}
async function validateBundleInternal(input: unknown): Promise<ExportBundle> {
  const result = envelope.safeParse(input);
  if (!result.success) fail('INVALID_IMPORT', '迁移格式或版本不支持', 400, result.error.issues);
  const bundle = result.data as ExportBundle;
  if (
    (await checksum({ data: bundle.data, source_revision: bundle.source_revision })) !==
    bundle.checksum
  )
    fail('CHECKSUM_MISMATCH', '迁移数据完整性校验失败');
  const s = bundle.data;
  for (const [key, pv] of Object.entries(s.packs)) {
    packVersionSchema.parse(pv);
    const pack = validatePack(pv.pack);
    check(
      key === `${pv.id}@${pv.version}` &&
        pv.id === pack.manifest.id &&
        pv.version === pack.manifest.version,
      '学习包版本引用不一致',
    );
    check((await checksum(pack)) === pv.checksum, '学习包校验失败');
  }
  for (const [key, g] of Object.entries(s.goals)) {
    goalSchema.parse(g);
    check(g.id === key && s.packs[`${g.pack_id}@${g.pack_version}`], '目标引用无效');
  }
  const lessonKeys = new Set<string>();
  const attemptKeys = new Set<string>();
  const unfinished = new Set<string>();
  for (const [key, l] of Object.entries(s.lessons)) {
    lessonSchema.parse(l);
    const unique = JSON.stringify([l.goal_id, l.idempotency_key]);
    check(!lessonKeys.has(unique), '课程幂等键重复');
    lessonKeys.add(unique);
    check(idSchema.safeParse(l.id).success && key === l.id && s.goals[l.goal_id], '课程引用无效');
    check(
      ['draft', 'published'].includes(l.status) && kindSchema.safeParse(l.kind).success,
      '课程状态无效',
    );
    const p = s.packs[`${l.pack_id}@${l.pack_version}`];
    check(
      p && p.id === s.goals[l.goal_id].pack_id && p.version === s.goals[l.goal_id].pack_version,
      '课程学习包引用无效',
    );
    check(
      l.status === 'published'
        ? iso.safeParse(l.published_at).success
        : l.published_at === undefined,
      '课程发布状态与时间不一致',
    );
    check(
      typeof l.title === 'string' &&
        typeof l.objective === 'string' &&
        typeof l.explanation === 'string' &&
        typeof l.example === 'string' &&
        iso.safeParse(l.created_at).success,
      '课程文本或时间无效',
    );
    check(
      Array.isArray(l.questions) &&
        l.questions.length > 0 &&
        new Set(l.questions.map((q) => q.id)).size === l.questions.length,
      '课程题目无效',
    );
    check(stableStringify(l.materials) === stableStringify(p.pack.materials), '课程材料快照不一致');
    const topics = new Set(p.pack.topics.map((t) => t.id));
    const materials = new Map(p.pack.materials.map((m) => [m.id, m]));
    check(
      l.topic_ids.every((t) => topics.has(t)),
      '课程知识点无效',
    );
    for (const q of l.questions) {
      validateQuestionReferences(q, topics, materials);
      if (q.source_type !== 'agent')
        check(
          stableStringify(q) ===
            stableStringify({
              ...p.pack.questions.find((pq) => pq.id === q.id),
              source_type: 'pack',
            }),
          '课程题库快照不一致',
        );
    }
  }
  for (const [key, a] of Object.entries(s.attempts)) {
    attemptSchema.parse(a);
    const unique = JSON.stringify([a.lesson_id, a.idempotency_key]);
    check(!attemptKeys.has(unique), '作答幂等键重复');
    attemptKeys.add(unique);
    if (a.status !== 'reviewed') {
      check(!unfinished.has(a.lesson_id), '同一课程有多份未完成作答');
      unfinished.add(a.lesson_id);
    }
    check(
      key === a.id &&
        s.lessons[a.lesson_id]?.status === 'published' &&
        s.lessons[a.lesson_id].goal_id === a.goal_id,
      '作答引用无效',
    );
    check(
      ['in_progress', 'submitted', 'reviewed'].includes(a.status) &&
        Number.isInteger(a.version) &&
        a.version >= 0 &&
        iso.safeParse(a.created_at).success,
      '作答状态无效',
    );
    check(a.answers && typeof a.answers === 'object' && !Array.isArray(a.answers), '答案无效');
    const l = s.lessons[a.lesson_id];
    for (const [qid, value] of Object.entries(a.answers)) {
      const q = l.questions.find((q) => q.id === qid);
      check(q && typeof value === 'string', '答案题目无效');
      if (q?.type === 'single_choice' && value)
        check(
          q.options!.some((o) => o.id === value),
          '无效的单选作答',
        );
    }
    if (a.status !== 'in_progress')
      check(
        l.questions.every((q) => typeof a.answers[q.id] === 'string' && a.answers[q.id].trim()) &&
          iso.safeParse(a.submitted_at).success,
        '提交答案不完整',
      );
  }
  const reviewed = new Set<string>();
  for (const [key, r] of Object.entries(s.reviews)) {
    reviewSchema.parse(r);
    const a = s.attempts[r.attempt_id];
    check(key === r.id && a?.status === 'reviewed' && !reviewed.has(a.id), '评价引用或状态无效');
    reviewed.add(a.id);
    const l = s.lessons[a.lesson_id];
    check(
      Number.isInteger(r.version) &&
        r.version >= 1 &&
        Array.isArray(r.grades) &&
        r.grades.length === l.questions.length &&
        new Set(r.grades.map((g) => g.question_id)).size === r.grades.length &&
        Array.isArray(r.revisions) &&
        r.revisions.length === r.version - 1,
      '评价版本或逐题成绩无效',
    );
    check(
      typeof r.summary === 'string' &&
        r.summary.trim() &&
        typeof r.next_steps === 'string' &&
        r.next_steps.trim() &&
        iso.safeParse(r.created_at).success,
      '评价反馈无效',
    );
    for (const g of r.grades) {
      const q = l.questions.find((q) => q.id === g.question_id);
      check(
        q &&
          Number.isFinite(g.score) &&
          g.score >= 0 &&
          g.score <= q.points &&
          typeof g.feedback === 'string' &&
          g.feedback.trim(),
        '逐题成绩范围无效',
      );
      if (q!.type === 'single_choice')
        check(g.score === (a.answers[q!.id] === q!.answer ? q!.points : 0), '客观题成绩被修改');
    }
    check(
      r.total === r.grades.reduce((n, g) => n + g.score, 0) &&
        r.max_score === l.questions.reduce((n, q) => n + q.points, 0),
      '总成绩不一致',
    );
    for (let i = 0; i < r.revisions.length; i++) {
      const prior = r.revisions[i];
      check(
        prior.version === i + 1 &&
          prior.grades.length === l.questions.length &&
          new Set(prior.grades.map((g) => g.question_id)).size === prior.grades.length,
        '修订历史版本不连续',
      );
      for (const grade of prior.grades) {
        const q = l.questions.find((q) => q.id === grade.question_id);
        check(q && grade.score <= q.points, '修订历史分数无效');
        if (q?.type === 'single_choice')
          check(
            grade.score === (a.answers[q.id] === q.answer ? q.points : 0),
            '修订历史客观分被改变',
          );
      }
      check(prior.total === prior.grades.reduce((n, g) => n + g.score, 0), '修订历史总分不一致');
    }
  }
  for (const a of Object.values(s.attempts))
    if (a.status === 'reviewed') check(reviewed.has(a.id), '已评阅作答缺少评价');
  const rebuilt = structuredClone(s);
  rebuildProgress(rebuilt);
  check(
    stableStringify(s.progress) === stableStringify(rebuilt.progress) &&
      stableStringify(s.evidence) === stableStringify(rebuilt.evidence),
    '进度/学习证据与成绩不一致',
  );
  return bundle;
}
