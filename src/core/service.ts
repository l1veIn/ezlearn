import {
  PLATFORM_VERSION,
  API_VERSION,
  AppError,
  fail,
  operationSchemas,
  mutationOperations,
  type Operation,
  type State,
  type Lesson,
  type Attempt,
  type Review,
  type Grade,
  type PackVersion,
} from '../contracts/index.js';
import { MAX_STATE_BYTES, type SnapshotStore } from '../storage/types.js';
import { validatePack, selectBlueprint, validateQuestionReferences } from './pack.js';
import { rebuildProgress } from './progress.js';
import {
  checksum,
  stableStringify,
  validateBundle,
  counts,
  type ExportBundle,
} from './integrity.js';

type Options = { baseUrl: string; backendId?: string; now?: () => Date };
const get = <T>(map: Record<string, T>, id: string, label: string): T =>
  Object.hasOwn(map, id) ? map[id] : fail('NOT_FOUND', `${label}不存在：${id}`, 404);
const uuid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export class LearningService {
  readonly baseUrl: string;
  readonly backendId: string;
  constructor(
    readonly store: SnapshotStore,
    readonly options: Options,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.backendId = options.backendId ?? this.baseUrl;
  }
  private now() {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  async execute(operation: string, input: unknown = {}): Promise<any> {
    if (!Object.hasOwn(operationSchemas, operation))
      fail('UNKNOWN_OPERATION', `未知操作：${operation}`, 404);
    const op = operation as Operation;
    const args = operationSchemas[op].parse(input);
    for (let retry = 0; retry < 8; retry++) {
      const snapshot = await this.store.read();
      const state = structuredClone(snapshot.state);
      const before = stableStringify(state);
      const result = await this.run(op, args, state, snapshot.revision);
      if (!mutationOperations.has(op) || stableStringify(state) === before) return result;
      if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_STATE_BYTES)
        fail(
          'CAPACITY_EXCEEDED',
          'v0.1 单用户状态容量为 1,500,000 字节；请先导出备份并迁移到后续扩容版本',
          413,
        );
      if (await this.store.compareAndSwap(snapshot.revision, state)) return result;
    }
    fail('WRITE_CONFLICT', '并发写入繁忙，请重试', 409);
  }
  private findPack(s: State, id: string, version?: string): PackVersion {
    if (version) return get(s.packs, `${id}@${version}`, '学习包版本');
    const found = Object.values(s.packs)
      .filter((p) => p.id === id)
      .sort((a, b) => {
        const av = a.version.split(/[.-]/).slice(0, 3).map(Number),
          bv = b.version.split(/[.-]/).slice(0, 3).map(Number);
        return (
          bv[0] - av[0] ||
          bv[1] - av[1] ||
          bv[2] - av[2] ||
          b.installed_at.localeCompare(a.installed_at)
        );
      })[0];
    return found ?? fail('NOT_FOUND', `尚未安装学习包 ${id}`, 404);
  }
  private lessonView(l: Lesson, teacher = false, reveal = false) {
    return {
      ...l,
      url: `${this.baseUrl}/lessons/${l.id}`,
      questions: l.questions.map((q) => {
        if (teacher || reveal) return q;
        const { answer, explanation, rubric, ...safe } = q;
        return safe;
      }),
    };
  }
  private handoff(a: Attempt) {
    return `/ezlearn 请继续阅卷。backend=${this.backendId}；base_url=${this.baseUrl}；attempt_id=${a.id}。请读取该记录及课程评分标准，逐题反馈并提交 review，再根据进度安排下一轮。不要猜测其他作答记录。`;
  }
  private due(s: State, goalId?: string) {
    return Object.values(s.progress)
      .filter((p) => (!goalId || p.goal_id === goalId) && p.due_at && p.due_at <= this.now())
      .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  }
  private validateAnswers(l: Lesson, answers: Record<string, string>, complete: boolean) {
    for (const [id, value] of Object.entries(answers)) {
      const q = l.questions.find((q) => q.id === id);
      if (!q) fail('INVALID_ANSWER', `答案引用了未知题目 ${id}`);
      if (q.type === 'single_choice' && value && !q.options!.some((o) => o.id === value))
        fail('INVALID_ANSWER', `题目 ${id} 的选项无效`);
    }
    if (complete && l.questions.some((q) => !answers[q.id]?.trim()))
      fail('INCOMPLETE_ANSWERS', '请完成每一道题后提交');
  }
  private async run(op: Operation, a: any, s: State, revision: number): Promise<any> {
    switch (op) {
      case 'get_status':
        return {
          version: PLATFORM_VERSION,
          api_version: API_VERSION,
          backend_id: this.backendId,
          base_url: this.baseUrl,
          revision,
          limits: { state_bytes: MAX_STATE_BYTES, pack_bytes: 384000 },
        };
      case 'dashboard':
        return {
          goals: Object.values(s.goals),
          packs: Object.values(s.packs).map(({ pack, ...p }) => ({
            ...p,
            manifest: pack.manifest,
            topics: pack.topics,
          })),
          lessons: Object.values(s.lessons)
            .filter((l) => l.status === 'published')
            .map((l) => {
              const { questions, materials, ...safe } = this.lessonView(l);
              return { ...safe, question_count: questions.length };
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
          attempts: Object.values(s.attempts).sort((a, b) =>
            b.created_at.localeCompare(a.created_at),
          ),
          progress: Object.values(s.progress),
          due_reviews: this.due(s),
          backend_id: this.backendId,
          base_url: this.baseUrl,
        };
      case 'validate_pack': {
        const p = validatePack(a.pack);
        return { valid: true, id: p.manifest.id, version: p.manifest.version };
      }
      case 'install_pack': {
        const pack = validatePack(a.pack);
        const key = `${pack.manifest.id}@${pack.manifest.version}`;
        const hash = await checksum(pack);
        const old = s.packs[key];
        if (old) {
          if (old.checksum !== hash)
            fail('IMMUTABLE_VERSION', '相同版本的内容不能改变；请增加版本号', 409);
          return old;
        }
        const pv: PackVersion = {
          id: pack.manifest.id,
          version: pack.manifest.version,
          pack,
          checksum: hash,
          source: a.source ?? { kind: 'local' },
          installed_at: this.now(),
        };
        s.packs[key] = pv;
        return pv;
      }
      case 'list_packs':
        return Object.values(s.packs);
      case 'get_pack':
        return this.findPack(s, a.id, a.version);
      case 'search_materials': {
        const tokens =
          String(a.query)
            .toLowerCase()
            .match(/[a-z0-9_-]+|[\u4e00-\u9fff]+/g) ?? [];
        const results: {
          material_id: string;
          pack_id: string;
          version: string;
          title: string;
          heading: string;
          line: number;
          snippet: string;
          source: string;
          score: number;
        }[] = [];
        for (const pv of Object.values(s.packs).filter((p) => !a.pack_id || p.id === a.pack_id))
          for (const m of pv.pack.materials) {
            let heading = m.title;
            const lines = m.content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/^#+\s/.test(line)) heading = line.replace(/^#+\s*/, '');
              const hay = `${heading} ${line}`.toLowerCase();
              const score = tokens.reduce(
                (n: number, t: string) => n + (hay.includes(t) ? 1 : 0),
                0,
              );
              if (score > 0 && line.trim())
                results.push({
                  material_id: m.id,
                  pack_id: pv.id,
                  version: pv.version,
                  title: m.title,
                  heading,
                  line: i + 1,
                  snippet: lines
                    .slice(Math.max(0, i - 1), i + 2)
                    .join('\n')
                    .slice(0, 700),
                  source: m.source,
                  score,
                });
            }
          }
        return results.sort((a, b) => b.score - a.score || a.line - b.line).slice(0, a.limit);
      }
      case 'create_goal': {
        const pv = this.findPack(s, a.pack_id, a.pack_version);
        const goal = {
          id: uuid('goal'),
          title: a.title,
          pack_id: pv.id,
          pack_version: pv.version,
          daily_minutes: a.daily_minutes,
          level: a.level,
          active: true,
          created_at: this.now(),
          ...(a.exam_date ? { exam_date: a.exam_date } : {}),
        };
        s.goals[goal.id] = goal;
        rebuildProgress(s);
        return goal;
      }
      case 'list_goals':
        return Object.values(s.goals);
      case 'get_goal':
        return get(s.goals, a.id, '目标');
      case 'update_goal': {
        const goal = get(s.goals, a.id, '目标');
        const { id, ...patch } = a;
        Object.assign(goal, patch);
        return goal;
      }
      case 'get_progress':
        if (a.goal_id) get(s.goals, a.goal_id, '目标');
        return Object.values(s.progress).filter((p) => !a.goal_id || p.goal_id === a.goal_id);
      case 'get_due_reviews':
        if (a.goal_id) get(s.goals, a.goal_id, '目标');
        return this.due(s, a.goal_id);
      case 'plan_next_session': {
        const goal = get(s.goals, a.goal_id, '目标');
        const lessons = Object.values(s.lessons)
          .filter((l) => l.goal_id === goal.id && l.status === 'published')
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        const pending = Object.values(s.attempts)
          .filter((at) => at.goal_id === goal.id && at.status === 'submitted')
          .sort((a, b) => b.submitted_at!.localeCompare(a.submitted_at!));
        if (pending.length)
          return {
            action: 'review_attempt',
            attempt: pending[0],
            pending_count: pending.length,
            lesson: this.lessonView(s.lessons[pending[0].lesson_id]),
            reason:
              pending.length === 1
                ? '先反馈已提交的作答'
                : '存在多份待阅卷；使用准确 attempt_id 和当前目标确认',
          };
        for (const l of lessons) {
          const attempts = Object.values(s.attempts).filter((at) => at.lesson_id === l.id);
          const inProgress = attempts.find((at) => at.status === 'in_progress');
          if (inProgress || attempts.length === 0)
            return {
              action: 'resume',
              lesson: this.lessonView(l),
              ...(inProgress ? { attempt: inProgress } : {}),
              reason: '继续尚未完成的课程',
            };
        }
        const pv = this.findPack(s, goal.pack_id, goal.pack_version);
        const topics = pv.pack.topics;
        const due = this.due(s, goal.id);
        const weak = Object.values(s.progress)
          .filter((p) => p.goal_id === goal.id && p.attempts > 0 && p.earned / p.possible < 0.6)
          .sort((a, b) => a.earned / a.possible - b.earned / b.possible);
        let id =
          due[0]?.topic_id ??
          weak[0]?.topic_id ??
          topics.find((t) => s.progress[`${goal.id}:${t.id}`]?.mastery !== 'demonstrated')?.id ??
          topics[0].id;
        const seen = new Set<string>();
        const findPrereq = (tid: string): string => {
          if (seen.has(tid)) return tid;
          seen.add(tid);
          const t = topics.find((t) => t.id === tid)!;
          const missing = t.prerequisites.find(
            (p) => s.progress[`${goal.id}:${p}`]?.mastery !== 'demonstrated',
          );
          return missing ? findPrereq(missing) : tid;
        };
        id = findPrereq(id);
        return {
          action: 'study',
          topic: topics.find((t) => t.id === id),
          reason: due.length
            ? '优先到期复习及其薄弱前置知识'
            : weak.length
              ? '先巩固错误较多的知识点及前置知识'
              : '依据目标与知识依赖选择下一小主题',
          daily_minutes: goal.daily_minutes,
        };
      }
      case 'create_lesson': {
        const goal = get(s.goals, a.goal_id, '目标');
        const pv = this.findPack(s, goal.pack_id, goal.pack_version);
        const requestHash = await checksum(a);
        const existing = Object.values(s.lessons).find(
          (l) => l.goal_id === goal.id && l.idempotency_key === a.idempotency_key,
        );
        if (existing) {
          if (existing.request_hash !== requestHash)
            fail('IDEMPOTENCY_CONFLICT', '相同课程幂等键对应了不同内容', 409);
          return this.lessonView(existing, true);
        }
        const topics = new Set(pv.pack.topics.map((t) => t.id));
        if (a.topic_ids.some((id: string) => !topics.has(id)))
          fail('INVALID_REFERENCE', '课程包含未知知识点');
        let questions: Lesson['questions'] = [];
        let blueprintId = a.blueprint_id;
        if (a.kind === 'mock' && (a.generated_questions?.length || a.question_ids?.length))
          fail('INVALID_BLUEPRINT', '正式模拟考试必须由学习包蓝图组卷');
        if (a.kind !== 'daily' || blueprintId) {
          const bp = pv.pack.blueprints.find((b) =>
            blueprintId ? b.id === blueprintId : b.kind === a.kind,
          );
          if (!bp || bp.kind !== a.kind) fail('INVALID_BLUEPRINT', '找不到对应类型的考试蓝图');
          blueprintId = bp.id;
          questions = selectBlueprint(pv.pack, bp.id);
          if (a.question_ids?.length || a.generated_questions?.length)
            fail('INVALID_BLUEPRINT', '使用蓝图时不能手动替换题目');
        } else if (a.question_ids?.length)
          questions = a.question_ids.map(
            (id: string) =>
              pv.pack.questions.find((q) => q.id === id) ??
              fail('NOT_FOUND', `题目不存在 ${id}`, 404),
          );
        else if (!a.generated_questions?.length)
          questions = pv.pack.questions
            .filter((q) => q.topic_ids.some((t) => a.topic_ids.includes(t)))
            .slice(0, 4);
        questions = questions.map((q) => ({ ...structuredClone(q), source_type: 'pack' }));
        const materials = new Map(pv.pack.materials.map((m) => [m.id, m]));
        for (const q of a.generated_questions ?? []) {
          validateQuestionReferences(q, topics, materials);
          questions.push({ ...q, source_type: 'agent' });
        }
        if (
          !questions.length ||
          questions.length > 30 ||
          new Set(questions.map((q) => q.id)).size !== questions.length
        )
          fail('INVALID_LESSON', '课程需包含 1～30 道 ID 唯一的题目');
        if (
          a.kind === 'daily' &&
          questions.some((q) => q.topic_ids.every((t) => !a.topic_ids.includes(t)))
        )
          fail('INVALID_LESSON', '日常练习必须关联本轮知识点');
        const lesson: Lesson = {
          id: uuid('lesson'),
          goal_id: goal.id,
          pack_id: pv.id,
          pack_version: pv.version,
          title: a.title,
          objective: a.objective,
          explanation: a.explanation,
          example: a.example,
          context_summary: a.context_summary,
          topic_ids: [
            ...new Set([...a.topic_ids, ...questions.flatMap((q) => q.topic_ids)]),
          ] as string[],
          kind: a.kind,
          minutes: a.minutes,
          status: 'draft',
          questions,
          materials: structuredClone(pv.pack.materials),
          created_at: this.now(),
          idempotency_key: a.idempotency_key,
          request_hash: requestHash,
          ...(blueprintId ? { blueprint_id: blueprintId } : {}),
        };
        s.lessons[lesson.id] = lesson;
        return this.lessonView(lesson, true);
      }
      case 'publish_lesson': {
        const lesson = get(s.lessons, a.id, '课程');
        if (lesson.status === 'draft') {
          lesson.status = 'published';
          lesson.published_at = this.now();
          rebuildProgress(s);
        }
        return this.lessonView(lesson, true);
      }
      case 'get_lesson': {
        const l = get(s.lessons, a.id, '课程');
        if (!a.teacher && l.status !== 'published') fail('NOT_FOUND', '课程尚未发布', 404);
        return this.lessonView(l, a.teacher);
      }
      case 'start_attempt': {
        const lesson = get(s.lessons, a.lesson_id, '课程');
        if (lesson.status !== 'published') fail('INVALID_STATE', '课程尚未发布', 409);
        const attempts = Object.values(s.attempts).filter((at) => at.lesson_id === lesson.id);
        const previous =
          attempts.find((at) => at.status === 'in_progress') ??
          attempts.find((at) => at.status === 'submitted') ??
          attempts.find((at) => at.idempotency_key === a.idempotency_key);
        if (previous)
          return {
            ...previous,
            ...(previous.status !== 'in_progress'
              ? { handoff_prompt: this.handoff(previous) }
              : {}),
          };
        const at: Attempt = {
          id: uuid('attempt'),
          lesson_id: lesson.id,
          goal_id: lesson.goal_id,
          status: 'in_progress',
          version: 0,
          answers: {},
          created_at: this.now(),
          idempotency_key: a.idempotency_key,
        };
        s.attempts[at.id] = at;
        return at;
      }
      case 'save_draft':
      case 'submit_attempt': {
        const at = get(s.attempts, a.id, '作答');
        const l = s.lessons[at.lesson_id];
        this.validateAnswers(l, a.answers, op === 'submit_attempt');
        if (at.status !== 'in_progress') {
          if (op === 'submit_attempt' && stableStringify(at.answers) === stableStringify(a.answers))
            return { ...at, handoff_prompt: this.handoff(at) };
          fail('INVALID_STATE', '已提交的答案不能修改', 409);
        }
        if (at.version !== a.expected_version)
          fail('VERSION_CONFLICT', '作答版本已过期，请刷新后重试', 409, {
            current_version: at.version,
          });
        at.answers = structuredClone(a.answers);
        at.version++;
        if (op === 'submit_attempt') {
          at.status = 'submitted';
          at.submitted_at = this.now();
          return { ...at, handoff_prompt: this.handoff(at) };
        }
        return at;
      }
      case 'list_pending_attempts':
        if (a.goal_id) get(s.goals, a.goal_id, '目标');
        return Object.values(s.attempts).filter(
          (at) => at.status === 'submitted' && (!a.goal_id || at.goal_id === a.goal_id),
        );
      case 'get_attempt': {
        const at = get(s.attempts, a.id, '作答');
        const review = Object.values(s.reviews).find((r) => r.attempt_id === at.id);
        return {
          attempt: at,
          lesson: this.lessonView(s.lessons[at.lesson_id], a.teacher, at.status === 'reviewed'),
          ...(review ? { review } : {}),
          handoff_prompt: this.handoff(at),
        };
      }
      case 'submit_review': {
        const at = get(s.attempts, a.attempt_id, '作答');
        if (at.status === 'in_progress') fail('INVALID_STATE', '用户尚未提交答案', 409);
        const l = s.lessons[at.lesson_id];
        const hash = await checksum(a);
        const previous = Object.values(s.reviews).find((r) => r.attempt_id === at.id);
        if (previous && previous.idempotency_key === a.idempotency_key) {
          if (previous.request_hash !== hash)
            fail('IDEMPOTENCY_CONFLICT', '相同阅卷幂等键对应不同反馈', 409);
          return previous;
        }
        if ((previous?.version ?? 0) !== a.expected_version)
          fail('VERSION_CONFLICT', '评价版本已过期', 409, {
            current_version: previous?.version ?? 0,
          });
        if (previous && !a.revision_reason?.trim())
          fail('REVISION_REASON_REQUIRED', '修改已完成评价必须说明修订依据');
        if (
          a.grades.length !== l.questions.length ||
          new Set(a.grades.map((g: Grade) => g.question_id)).size !== a.grades.length
        )
          fail('INVALID_GRADES', '必须为每一道题提供唯一的反馈');
        const grades: Grade[] = l.questions.map((q) => {
          const grade = a.grades.find((g: Grade) => g.question_id === q.id);
          if (!grade) fail('INVALID_GRADES', `缺少题目 ${q.id} 的评分`);
          if (grade.score > q.points) fail('SCORE_OUT_OF_RANGE', `题目 ${q.id} 得分超出上限`);
          return {
            question_id: q.id,
            score:
              q.type === 'single_choice'
                ? at.answers[q.id] === q.answer
                  ? q.points
                  : 0
                : grade.score,
            feedback: grade.feedback,
          };
        });
        const review: Review = {
          id: previous?.id ?? uuid('review'),
          attempt_id: at.id,
          version: (previous?.version ?? 0) + 1,
          grades,
          total: grades.reduce((n, g) => n + g.score, 0),
          max_score: l.questions.reduce((n, q) => n + q.points, 0),
          summary: a.summary,
          next_steps: a.next_steps,
          created_at: previous?.created_at ?? this.now(),
          idempotency_key: a.idempotency_key,
          request_hash: hash,
          revisions: previous
            ? [
                ...previous.revisions,
                {
                  version: previous.version,
                  grades: previous.grades,
                  total: previous.total,
                  summary: previous.summary,
                  next_steps: previous.next_steps,
                  reason: a.revision_reason,
                  replaced_at: this.now(),
                },
              ]
            : [],
        };
        s.reviews[review.id] = review;
        at.status = 'reviewed';
        at.version++;
        rebuildProgress(s);
        return review;
      }
      case 'export_data': {
        const bundle: ExportBundle = {
          format: 'ezlearn-export',
          version: 1,
          exported_at: this.now(),
          source_revision: revision,
          checksum: await checksum({ data: s, source_revision: revision }),
          data: s,
        };
        return bundle;
      }
      case 'validate_import': {
        const b = await validateBundle(a.bundle);
        return {
          valid: true,
          counts: counts(b.data),
          source_revision: b.source_revision,
          checksum: b.checksum,
        };
      }
      case 'import_data': {
        if (Object.entries(counts(s)).some(([, n]) => n > 0))
          fail('NONEMPTY_TARGET', '只支持导入空实例；请使用新的数据目录或数据库', 409);
        const b = await validateBundle(a.bundle);
        Object.assign(s, structuredClone(b.data));
        return {
          imported: true,
          counts: counts(s),
          source_revision: b.source_revision,
          checksum: b.checksum,
          base_url: this.baseUrl,
        };
      }
    }
  }
}
