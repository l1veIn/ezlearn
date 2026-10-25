import { z } from 'zod';

export const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v), '保留 ID');
const text = z.string().trim().min(1).max(20000);
const short = z.string().trim().min(1).max(300);
export const kindSchema = z.enum(['daily', 'diagnostic', 'checkpoint', 'mock']);
export const questionSchema = z
  .object({
    id: idSchema,
    type: z.enum(['single_choice', 'short_answer']),
    prompt: text,
    options: z
      .array(z.object({ id: idSchema, text: short }).strict())
      .min(2)
      .max(8)
      .optional(),
    answer: text,
    explanation: text,
    points: z.number().int().min(1).max(100),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    topic_ids: z.array(idSchema).min(1).max(10),
    material_refs: z
      .array(z.object({ material_id: idSchema, heading: short.optional() }).strict())
      .min(1)
      .max(10),
    rubric: z
      .array(z.object({ criterion: short, points: z.number().positive().max(100) }).strict())
      .min(1)
      .max(10)
      .optional(),
    source_type: z.enum(['pack', 'agent']).optional(),
  })
  .strict()
  .superRefine((q, c) => {
    if (new Set(q.topic_ids).size !== q.topic_ids.length)
      c.addIssue({ code: 'custom', message: '题目知识点不能重复' });
    if (
      q.type === 'single_choice' &&
      (!q.options?.some((o) => o.id === q.answer) ||
        new Set(q.options.map((o) => o.id)).size !== q.options.length)
    )
      c.addIssue({ code: 'custom', message: '单选答案必须是唯一选项 ID' });
    if (
      q.type === 'short_answer' &&
      (!q.rubric || Math.abs(q.rubric.reduce((n, r) => n + r.points, 0) - q.points) > 0.001)
    )
      c.addIssue({ code: 'custom', message: '简答题 rubric 分值之和必须等于题目分值' });
  });
export const materialSchema = z
  .object({
    id: idSchema,
    title: short,
    path: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (p) =>
          !p.includes('\\') &&
          !p.startsWith('/') &&
          !p.includes(':') &&
          p.split('/').every((s) => s !== '.' && s !== '..' && s.length > 0),
        '材料必须使用安全相对路径',
      ),
    content: text,
    source: short,
  })
  .strict();
export const packSchema = z
  .object({
    manifest: z
      .object({
        schema_version: z.literal(1),
        id: idSchema,
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
        name: short,
        language: short,
        description: text,
        goals: z.array(short).min(1),
        license: short,
        source: short,
        teaching: z.object({ minutes: z.number().int().min(5).max(60), advice: text }).strict(),
      })
      .strict(),
    topics: z
      .array(
        z.object({ id: idSchema, title: short, prerequisites: z.array(idSchema).max(20) }).strict(),
      )
      .min(1)
      .max(100),
    materials: z.array(materialSchema).min(1).max(50),
    questions: z.array(questionSchema).min(1).max(500),
    blueprints: z
      .array(
        z
          .object({
            id: idSchema,
            name: short,
            kind: kindSchema,
            sections: z
              .array(
                z
                  .object({
                    type: z.enum(['single_choice', 'short_answer']),
                    count: z.number().int().min(1).max(30),
                    points: z.number().int().min(1).max(100),
                    topic_ids: z.array(idSchema).min(1),
                  })
                  .strict(),
              )
              .min(1)
              .max(10),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type Question = z.infer<typeof questionSchema>;
export type Pack = z.infer<typeof packSchema>;
export type Kind = z.infer<typeof kindSchema>;
export type PackSource = {
  kind: 'local' | 'github' | 'import';
  url?: string;
  ref?: string;
  resolved?: string;
};
export interface PackVersion {
  id: string;
  version: string;
  pack: Pack;
  checksum: string;
  source: PackSource;
  installed_at: string;
}
export interface Goal {
  id: string;
  title: string;
  pack_id: string;
  pack_version: string;
  daily_minutes: number;
  exam_date?: string;
  level: string;
  active: boolean;
  created_at: string;
}
export interface Lesson {
  id: string;
  goal_id: string;
  pack_id: string;
  pack_version: string;
  title: string;
  objective: string;
  explanation: string;
  example: string;
  context_summary: string;
  topic_ids: string[];
  kind: Kind;
  minutes: number;
  status: 'draft' | 'published';
  questions: Question[];
  materials: Pack['materials'];
  created_at: string;
  published_at?: string;
  idempotency_key: string;
  request_hash: string;
  blueprint_id?: string;
}
export interface Attempt {
  id: string;
  lesson_id: string;
  goal_id: string;
  status: 'in_progress' | 'submitted' | 'reviewed';
  version: number;
  answers: Record<string, string>;
  created_at: string;
  submitted_at?: string;
  idempotency_key: string;
}
export interface Grade {
  question_id: string;
  score: number;
  feedback: string;
}
export interface Review {
  id: string;
  attempt_id: string;
  version: number;
  grades: Grade[];
  total: number;
  max_score: number;
  summary: string;
  next_steps: string;
  created_at: string;
  idempotency_key: string;
  request_hash: string;
  revisions: {
    version: number;
    grades: Grade[];
    total: number;
    summary: string;
    next_steps: string;
    reason: string;
    replaced_at: string;
  }[];
}
export interface Progress {
  goal_id: string;
  topic_id: string;
  exposures: number;
  attempts: number;
  correct: number;
  earned: number;
  possible: number;
  last_practiced_at?: string;
  due_at?: string;
  mastery: 'unknown' | 'learning' | 'practicing' | 'demonstrated';
}
export interface Evidence {
  id: string;
  goal_id: string;
  topic_id: string;
  attempt_id: string;
  review_id: string;
  review_version: number;
  question_id: string;
  score: number;
  possible: number;
  kind: Kind;
  at: string;
}
export interface State {
  schema_version: 1;
  packs: Record<string, PackVersion>;
  goals: Record<string, Goal>;
  lessons: Record<string, Lesson>;
  attempts: Record<string, Attempt>;
  reviews: Record<string, Review>;
  progress: Record<string, Progress>;
  evidence: Record<string, Evidence>;
}
export const emptyState = (): State => ({
  schema_version: 1,
  packs: {},
  goals: {},
  lessons: {},
  attempts: {},
  reviews: {},
  progress: {},
  evidence: {},
});
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function fail(code: string, message: string, status = 400, details?: unknown): never {
  throw new AppError(code, message, status, details);
}
const goalId = z.object({ goal_id: idSchema.optional() }).strict();
const answers = z.record(idSchema, z.string().max(10000));
const bundle = z.unknown();
export const operationSchemas = {
  get_status: z.object({}).strict(),
  dashboard: z.object({}).strict(),
  install_pack: z
    .object({
      pack: packSchema,
      source: z
        .object({
          kind: z.enum(['local', 'github', 'import']),
          url: z.string().max(500).optional(),
          ref: z.string().max(200).optional(),
          resolved: z.string().max(200).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  validate_pack: z.object({ pack: packSchema }).strict(),
  list_packs: z.object({}).strict(),
  get_pack: z.object({ id: idSchema, version: z.string().optional() }).strict(),
  search_materials: z
    .object({
      query: z.string().min(1).max(200),
      pack_id: idSchema.optional(),
      limit: z.number().int().min(1).max(20).default(8),
    })
    .strict(),
  create_goal: z
    .object({
      title: short,
      pack_id: idSchema,
      pack_version: z.string().optional(),
      daily_minutes: z.number().int().min(5).max(60).default(15),
      exam_date: z.iso.date().optional(),
      level: short.default('unknown'),
    })
    .strict(),
  list_goals: z.object({}).strict(),
  get_goal: z.object({ id: idSchema }).strict(),
  update_goal: z
    .object({
      id: idSchema,
      title: short.optional(),
      daily_minutes: z.number().int().min(5).max(60).optional(),
      exam_date: z.iso.date().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  get_progress: goalId,
  get_due_reviews: goalId,
  plan_next_session: z.object({ goal_id: idSchema }).strict(),
  create_lesson: z
    .object({
      goal_id: idSchema,
      title: short,
      objective: text,
      explanation: text,
      example: text,
      context_summary: z.string().max(3000).default(''),
      topic_ids: z.array(idSchema).min(1).max(10),
      question_ids: z.array(idSchema).max(30).optional(),
      generated_questions: z.array(questionSchema).max(10).optional(),
      kind: kindSchema.default('daily'),
      blueprint_id: idSchema.optional(),
      minutes: z.number().int().min(5).max(60).default(15),
      idempotency_key: z.string().min(1).max(200),
    })
    .strict(),
  publish_lesson: z.object({ id: idSchema }).strict(),
  get_lesson: z.object({ id: idSchema, teacher: z.boolean().default(false) }).strict(),
  start_attempt: z
    .object({ lesson_id: idSchema, idempotency_key: z.string().min(1).max(200) })
    .strict(),
  save_draft: z
    .object({ id: idSchema, expected_version: z.number().int().nonnegative(), answers })
    .strict(),
  submit_attempt: z
    .object({ id: idSchema, expected_version: z.number().int().nonnegative(), answers })
    .strict(),
  list_pending_attempts: goalId,
  get_attempt: z.object({ id: idSchema, teacher: z.boolean().default(false) }).strict(),
  submit_review: z
    .object({
      attempt_id: idSchema,
      idempotency_key: z.string().min(1).max(200),
      expected_version: z.number().int().nonnegative(),
      grades: z
        .array(
          z
            .object({ question_id: idSchema, score: z.number().min(0).max(100), feedback: text })
            .strict(),
        )
        .min(1)
        .max(30),
      summary: text,
      next_steps: text,
      revision_reason: text.optional(),
    })
    .strict(),
  export_data: z.object({}).strict(),
  validate_import: z.object({ bundle }).strict(),
  import_data: z.object({ bundle }).strict(),
} as const;
export type Operation = keyof typeof operationSchemas;
export const operations = Object.keys(operationSchemas) as Operation[];
export const mutationOperations = new Set<Operation>([
  'install_pack',
  'create_goal',
  'update_goal',
  'create_lesson',
  'publish_lesson',
  'start_attempt',
  'save_draft',
  'submit_attempt',
  'submit_review',
  'import_data',
]);
export const learnerOperations = new Set<Operation>([
  'get_status',
  'dashboard',
  'create_goal',
  'list_goals',
  'get_goal',
  'update_goal',
  'list_packs',
  'get_progress',
  'get_due_reviews',
  'plan_next_session',
  'get_lesson',
  'start_attempt',
  'save_draft',
  'submit_attempt',
  'get_attempt',
]);
export function errorResult(error: unknown) {
  if (error instanceof AppError)
    return {
      ok: false as const,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  if (error instanceof z.ZodError)
    return {
      ok: false as const,
      error: { code: 'VALIDATION_ERROR', message: '输入格式不正确', details: error.issues },
    };
  return {
    ok: false as const,
    error: { code: 'INTERNAL_ERROR', message: '操作失败，请查看服务日志' },
  };
}
