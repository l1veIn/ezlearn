import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LearningService } from '../src/core/service.js';
import { createLocalStore } from '../src/storage/local.js';
import { checksum } from '../src/core/integrity.js';
import type { SnapshotStore } from '../src/storage/types.js';
import type { Pack } from '../src/contracts/index.js';
import { selectBlueprint, validatePack } from '../src/core/pack.js';

const pack: Pack = JSON.parse(readFileSync('packs/english-demo/pack.json', 'utf8'));
const dirs: string[] = [];
const stores: SnapshotStore[] = [];
function service(baseUrl = 'http://127.0.0.1:3210') {
  const dir = mkdtempSync(join(tmpdir(), 'ezlearn-'));
  dirs.push(dir);
  const store = createLocalStore(join(dir, 'learning.sqlite'));
  stores.push(store);
  return new LearningService(store, { baseUrl, now: () => new Date('2026-10-25T04:00:00.000Z') });
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close?.();
  await new Promise((r) => setTimeout(r, 30));
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});
async function setup(s = service()) {
  await s.execute('install_pack', { pack, source: { kind: 'local' } });
  const goal = await s.execute('create_goal', {
    title: '每天 15 分钟英语',
    pack_id: pack.manifest.id,
  });
  const topic = pack.topics[0];
  const qs = [
    pack.questions.find((q) => q.type === 'single_choice' && q.topic_ids.includes(topic.id))!,
    pack.questions.find((q) => q.type === 'short_answer' && q.topic_ids.includes(topic.id))!,
  ];
  const input = {
    goal_id: goal.id,
    title: '从接口重试理解条件句',
    objective: '用 if 表达条件',
    explanation: 'If the request fails, retry once. if 从句使用一般现在时。',
    example: 'If the API times out, we will retry once.',
    topic_ids: [topic.id],
    question_ids: qs.map((q) => q.id),
    idempotency_key: 'daily:2026-10-25',
  };
  const lesson = await s.execute('create_lesson', input);
  await s.execute('publish_lesson', { id: lesson.id });
  return { s, goal, lesson, qs, input };
}
async function submit(f: Awaited<ReturnType<typeof setup>>, wrong = false) {
  const at = await f.s.execute('start_attempt', {
    lesson_id: f.lesson.id,
    idempotency_key: 'first',
  });
  const answers = Object.fromEntries(
    f.qs.map((q) => [
      q.id,
      q.type === 'single_choice'
        ? wrong
          ? q.options!.find((o) => o.id !== q.answer)!.id
          : q.answer
        : 'If the request fails, retry once.',
    ]),
  );
  const draft = await f.s.execute('save_draft', {
    id: at.id,
    expected_version: at.version,
    answers,
  });
  const submitted = await f.s.execute('submit_attempt', {
    id: at.id,
    expected_version: draft.version,
    answers,
  });
  return { at: submitted, answers };
}
function reviewInput(f: Awaited<ReturnType<typeof setup>>, at: any) {
  return {
    attempt_id: at.id,
    idempotency_key: 'review:first',
    expected_version: 0,
    grades: f.qs.map((q) => ({
      question_id: q.id,
      score: q.type === 'single_choice' ? 0 : q.points,
      feedback: '条件和动作表达清楚。',
    })),
    summary: '本轮完成',
    next_steps: '复习条件句并迁移到新的接口场景',
  };
}

describe('真实 SQLite 学习闭环', () => {
  it('草稿恢复、提交交接、平台客观阅卷、证据和幂等', async () => {
    const f = await setup();
    const { at, answers } = await submit(f);
    const publicLesson = await f.s.execute('get_lesson', { id: f.lesson.id });
    expect(publicLesson.questions[0].answer).toBeUndefined();
    expect(at.status).toBe('submitted');
    expect(at.handoff_prompt).toContain(at.id);
    expect(at.handoff_prompt).toContain('backend=');
    const pending = await f.s.execute('plan_next_session', { goal_id: f.goal.id });
    expect(pending.action).toBe('review_attempt');
    const rev = reviewInput(f, at);
    const review = await f.s.execute('submit_review', rev);
    expect(review.total).toBe(f.qs.reduce((n, q) => n + q.points, 0)); // Agent's 0 for objective cannot override key.
    const progress = await f.s.execute('get_progress', { goal_id: f.goal.id });
    expect(progress[0].attempts).toBe(2);
    expect(progress[0].mastery).toBe('demonstrated');
    const before = await f.s.execute('export_data');
    expect(
      (await f.s.execute('submit_attempt', { id: at.id, expected_version: 0, answers })).status,
    ).toBe('reviewed');
    expect(await f.s.execute('submit_review', rev)).toEqual(review);
    const after = await f.s.execute('export_data');
    expect(after.source_revision).toBe(before.source_revision);
    expect(after.checksum).toBe(before.checksum);
    expect((await f.s.execute('get_attempt', { id: at.id })).lesson.questions[0].answer).toBe(
      f.qs[0].answer,
    );
  });
  it('拒绝过期草稿、无效状态、缺题、主观题越界和不完整反馈', async () => {
    const f = await setup();
    const at = await f.s.execute('start_attempt', { lesson_id: f.lesson.id, idempotency_key: 'x' });
    await expect(f.s.execute('submit_review', reviewInput(f, at))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await f.s.execute('save_draft', { id: at.id, expected_version: 0, answers: {} });
    await expect(
      f.s.execute('save_draft', { id: at.id, expected_version: 0, answers: {} }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      f.s.execute('submit_attempt', { id: at.id, expected_version: 1, answers: {} }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_ANSWERS' });
    const { at: sub } = await submit(f);
    const input = reviewInput(f, sub);
    input.grades[1].score = 999;
    await expect(f.s.execute('submit_review', input)).rejects.toThrow();
    input.grades[1].score = f.qs[1].points + 1;
    await expect(f.s.execute('submit_review', input)).rejects.toMatchObject({
      code: 'SCORE_OUT_OF_RANGE',
    });
    input.grades.pop();
    await expect(f.s.execute('submit_review', input)).rejects.toMatchObject({
      code: 'INVALID_GRADES',
    });
  });
  it('两连接并发提交只保留一份作答和成绩', async () => {
    const f = await setup();
    const first = await f.s.execute('start_attempt', {
      lesson_id: f.lesson.id,
      idempotency_key: 'x',
    });
    const secondStore = createLocalStore(join(dirs[0], 'learning.sqlite'));
    stores.push(secondStore);
    const second = new LearningService(secondStore, { baseUrl: 'http://localhost:3210' });
    const results = await Promise.all([
      f.s.execute('start_attempt', { lesson_id: f.lesson.id, idempotency_key: 'x' }),
      second.execute('start_attempt', { lesson_id: f.lesson.id, idempotency_key: 'x' }),
    ]);
    expect(new Set(results.map((a) => a.id))).toEqual(new Set([first.id]));
    const answers = Object.fromEntries(f.qs.map((q) => [q.id, q.answer]));
    await Promise.all(
      Array.from({ length: 4 }, () =>
        f.s.execute('submit_attempt', { id: first.id, expected_version: 0, answers }),
      ),
    );
    const input = reviewInput(f, first);
    const reviewed = await Promise.all(
      Array.from({ length: 4 }, () => f.s.execute('submit_review', input)),
    );
    expect(new Set(reviewed.map((r) => r.id)).size).toBe(1);
    const progress = await f.s.execute('get_progress', { goal_id: f.goal.id });
    expect(progress[0].attempts).toBe(2);
  });
  it('重做创建新作答，刷新恢复重做草稿，待阅卷优先交接', async () => {
    const f = await setup();
    const { at } = await submit(f);
    await f.s.execute('submit_review', reviewInput(f, at));
    const retake = await f.s.execute('start_attempt', {
      lesson_id: f.lesson.id,
      idempotency_key: 'retake',
    });
    expect(retake.id).not.toBe(at.id);
    const restored = await f.s.execute('start_attempt', {
      lesson_id: f.lesson.id,
      idempotency_key: 'first',
    });
    expect(restored.id).toBe(retake.id);
    await f.s.execute('submit_attempt', {
      id: retake.id,
      expected_version: 0,
      answers: Object.fromEntries(f.qs.map((q) => [q.id, q.answer])),
    });
    const pending = await f.s.execute('start_attempt', {
      lesson_id: f.lesson.id,
      idempotency_key: 'new-but-pending',
    });
    expect(pending.id).toBe(retake.id);
    expect(pending.status).toBe('submitted');
  });
  it('修订保留依据，重建进度不会重复积累；错误优先，未摸底能力为unknown', async () => {
    const f = await setup();
    expect(
      (await f.s.execute('get_progress', { goal_id: f.goal.id })).every(
        (p: any) => p.mastery === 'unknown',
      ),
    ).toBe(true);
    const { at } = await submit(f, true);
    const input = reviewInput(f, at);
    input.grades[1].score = 0;
    const r = await f.s.execute('submit_review', input);
    expect((await f.s.execute('plan_next_session', { goal_id: f.goal.id })).topic.id).toBe(
      pack.topics[0].id,
    );
    const patch = { ...input, idempotency_key: 'revision:2', expected_version: r.version };
    await expect(f.s.execute('submit_review', patch)).rejects.toMatchObject({
      code: 'REVISION_REASON_REQUIRED',
    });
    const revised = await f.s.execute('submit_review', {
      ...patch,
      revision_reason: '复核 rubric 中的动作表达得分',
      grades: input.grades.map((g, i) => ({ ...g, score: i === 1 ? f.qs[1].points : 0 })),
    });
    expect(revised.revisions).toHaveLength(1);
    expect(revised.version).toBe(2);
    expect((await f.s.execute('get_progress', { goal_id: f.goal.id }))[0].attempts).toBe(2);
  });
  it('发布快照和旧成绩不随包升级改变，蓝图遵守数量/分值/覆盖', async () => {
    const f = await setup();
    const changed = structuredClone(pack);
    changed.questions[0].prompt = '变更题目';
    await expect(f.s.execute('install_pack', { pack: changed })).rejects.toMatchObject({
      code: 'IMMUTABLE_VERSION',
    });
    changed.manifest.version = '1.1.0';
    await f.s.execute('install_pack', { pack: changed });
    expect(
      (await f.s.execute('get_lesson', { id: f.lesson.id, teacher: true })).questions[0].prompt,
    ).toBe(f.qs[0].prompt);
    const mock = await f.s.execute('create_lesson', {
      ...f.input,
      kind: 'mock',
      question_ids: undefined,
      idempotency_key: 'mock-1',
    });
    const bp = pack.blueprints.find((b) => b.kind === 'mock')!;
    expect(mock.questions.length).toBe(bp.sections.reduce((n, s) => n + s.count, 0));
    expect(new Set(mock.questions.flatMap((q: any) => q.topic_ids)).size).toBe(4);
    await expect(
      f.s.execute('create_lesson', { ...f.input, kind: 'mock', idempotency_key: 'bad-mock' }),
    ).rejects.toMatchObject({ code: 'INVALID_BLUEPRINT' });
  });
  it('SQLite 重启与迁移换URL后保留历史成绩、待阅卷、材料和续学', async () => {
    const f = await setup();
    const { at } = await submit(f);
    await f.s.execute('submit_review', reviewInput(f, at));
    const l2 = await f.s.execute('create_lesson', { ...f.input, idempotency_key: 'tomorrow' });
    await f.s.execute('publish_lesson', { id: l2.id });
    const pending = await f.s.execute('start_attempt', {
      lesson_id: l2.id,
      idempotency_key: 'two',
    });
    const answers = Object.fromEntries(f.qs.map((q) => [q.id, q.answer]));
    await f.s.execute('submit_attempt', { id: pending.id, expected_version: 0, answers });
    const bundle = await f.s.execute('export_data');
    const target = service('https://new.example.test');
    const result = await target.execute('import_data', { bundle });
    expect(result.counts.lessons).toBe(2);
    expect(result.counts.reviews).toBe(1);
    expect(
      (await target.execute('get_lesson', { id: f.lesson.id })).url.startsWith(
        'https://new.example.test/',
      ),
    ).toBe(true);
    expect((await target.execute('get_attempt', { id: at.id })).review.total).toBe(
      bundle.data.reviews[Object.keys(bundle.data.reviews)[0]].total,
    );
    expect((await target.execute('list_pending_attempts'))[0].id).toBe(pending.id);
    expect((await target.execute('plan_next_session', { goal_id: f.goal.id })).action).toBe(
      'review_attempt',
    );
    expect(
      (await target.execute('search_materials', { query: 'retry' }))[0].material_id,
    ).toBeTruthy();
    await expect(target.execute('import_data', { bundle })).rejects.toMatchObject({
      code: 'NONEMPTY_TARGET',
    });
    const path = join(dirs[dirs.length - 1], 'learning.sqlite');
    await target.store.close?.();
    stores.splice(stores.indexOf(target.store), 1);
    const reopened = createLocalStore(path);
    stores.push(reopened);
    expect(
      (
        await new LearningService(reopened, { baseUrl: 'http://localhost:9999' }).execute(
          'list_pending_attempts',
        )
      )[0].id,
    ).toBe(pending.id);
  });
  it('损坏/不支持版本/悬空引用的迁移被原子拒绝', async () => {
    const f = await setup();
    const bundle = await f.s.execute('export_data');
    const target = service();
    await expect(
      target.execute('import_data', { bundle: { ...bundle, version: 999 } }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    const damaged = structuredClone(bundle);
    damaged.data.goals[f.goal.id].title = '损坏';
    await expect(target.execute('import_data', { bundle: damaged })).rejects.toMatchObject({
      code: 'CHECKSUM_MISMATCH',
    });
    const invalid = structuredClone(bundle);
    invalid.data.lessons[f.lesson.id].goal_id = 'missing';
    invalid.checksum = await checksum({
      data: invalid.data,
      source_revision: invalid.source_revision,
    });
    await expect(target.execute('import_data', { bundle: invalid })).rejects.toMatchObject({
      code: 'INVALID_IMPORT',
    });
    expect((await target.execute('list_goals')).length).toBe(0);
  });
  it('导入不能带入重复未完成作答或重复幂等键', async () => {
    const f = await setup();
    const at = await f.s.execute('start_attempt', {
      lesson_id: f.lesson.id,
      idempotency_key: 'first',
    });
    const original = await f.s.execute('export_data');
    const target = service();
    const duplicate = structuredClone(original);
    duplicate.data.attempts['attempt_duplicate'] = {
      ...duplicate.data.attempts[at.id],
      id: 'attempt_duplicate',
      idempotency_key: 'other',
    };
    duplicate.checksum = await checksum({
      data: duplicate.data,
      source_revision: duplicate.source_revision,
    });
    await expect(target.execute('import_data', { bundle: duplicate })).rejects.toMatchObject({
      code: 'INVALID_IMPORT',
    });
    const duplicateLesson = structuredClone(original);
    duplicateLesson.data.lessons['lesson_duplicate'] = {
      ...duplicateLesson.data.lessons[f.lesson.id],
      id: 'lesson_duplicate',
    };
    duplicateLesson.checksum = await checksum({
      data: duplicateLesson.data,
      source_revision: duplicateLesson.source_revision,
    });
    await expect(target.execute('import_data', { bundle: duplicateLesson })).rejects.toMatchObject({
      code: 'INVALID_IMPORT',
    });
    expect((await target.execute('list_goals')).length).toBe(0);
  });
  it('libSQL 实际适配器与 SQLite 使用相同语义', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ezlearn-libsql-'));
    dirs.push(dir);
    // Native libSQL keeps a Windows file handle until process exit; verify in a real child process.
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'tests/helpers/libsql-flow.ts', join(dir, 'libsql.db')],
        { encoding: 'utf8' },
      ),
    );
    expect(result.total).toBe(result.max_score);
    expect(result.attempts).toBe(2);
    expect(result.imported).toBe(true);
  });
  it('包拒绝路径穿越、依赖环、坏材料引用和不可能蓝图', async () => {
    const s = service();
    let invalid = structuredClone(pack);
    invalid.materials[0].path = '../outside.md';
    await expect(s.execute('validate_pack', { pack: invalid })).rejects.toThrow();
    invalid = structuredClone(pack);
    invalid.topics[0].prerequisites = [invalid.topics[0].id];
    await expect(s.execute('validate_pack', { pack: invalid })).rejects.toMatchObject({
      code: 'INVALID_PACK',
    });
    invalid = structuredClone(pack);
    invalid.questions[0].material_refs[0].material_id = 'absent';
    await expect(s.execute('validate_pack', { pack: invalid })).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
    });
    invalid = structuredClone(pack);
    invalid.blueprints[0].sections[0].count = 30;
    await expect(s.execute('validate_pack', { pack: invalid })).rejects.toMatchObject({
      code: 'INVALID_BLUEPRINT',
    });
  });
  it('重复知识点不能把一道生成题变成两份掌握证据', async () => {
    const f = await setup();
    const question = {
      ...f.qs[0],
      id: 'generated-duplicate-topic',
      topic_ids: [pack.topics[0].id, pack.topics[0].id],
      source_type: 'agent',
    };
    await expect(
      f.s.execute('create_lesson', {
        ...f.input,
        question_ids: [],
        generated_questions: [question],
        idempotency_key: 'duplicate',
      }),
    ).rejects.toThrow();
    const corrected = { ...question, topic_ids: [pack.topics[0].id] };
    const lesson = await f.s.execute('create_lesson', {
      ...f.input,
      question_ids: [],
      generated_questions: [corrected],
      idempotency_key: 'valid-generated',
    });
    await f.s.execute('publish_lesson', { id: lesson.id });
    const attempt = await f.s.execute('start_attempt', {
      lesson_id: lesson.id,
      idempotency_key: 'one',
    });
    await f.s.execute('submit_attempt', {
      id: attempt.id,
      expected_version: 0,
      answers: { [corrected.id]: corrected.answer },
    });
    await f.s.execute('submit_review', {
      attempt_id: attempt.id,
      idempotency_key: 'one',
      expected_version: 0,
      grades: [{ question_id: corrected.id, score: corrected.points, feedback: '正确' }],
      summary: '完成',
      next_steps: '再练一个迁移题',
    });
    const p = (await f.s.execute('get_progress', { goal_id: f.goal.id }))[0];
    expect(p.attempts).toBe(1);
    expect(p.mastery).not.toBe('demonstrated');
    const exported = await f.s.execute('export_data');
    expect((await f.s.execute('validate_import', { bundle: exported })).valid).toBe(true);
  });
  it('蓝图遇到覆盖贪心陷阱时仍能找到符合约束的题组', () => {
    const p = structuredClone(pack);
    p.topics = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id, title: id, prerequisites: [] }));
    const q = p.questions[0];
    p.questions = [
      { ...q, id: 'q1', topic_ids: ['A', 'B', 'C', 'D'] },
      { ...q, id: 'q2', topic_ids: ['A', 'B', 'E'] },
      { ...q, id: 'q3', topic_ids: ['C', 'D', 'F'] },
    ];
    p.blueprints = [
      {
        id: 'cover',
        name: '覆盖测试',
        kind: 'mock',
        sections: [
          {
            type: 'single_choice',
            count: 2,
            points: q.points,
            topic_ids: ['A', 'B', 'C', 'D', 'E', 'F'],
          },
        ],
      },
    ];
    validatePack(p);
    const selected = selectBlueprint(p, 'cover');
    expect(selected.map((q) => q.id).sort()).toEqual(['q2', 'q3']);
    expect(new Set(selected.flatMap((q) => q.topic_ids)).size).toBe(6);
  });
});
