import { createClient } from '@libsql/client';
import { createLibsqlStore, initializeLibsql } from '../../src/storage/libsql.js';
import { LearningService } from '../../src/core/service.js';
import { readFileSync } from 'node:fs';
const client = createClient({ url: `file:${process.argv[2]}` });
await initializeLibsql(client);
const service = new LearningService(createLibsqlStore(client), {
  baseUrl: 'https://vercel.example.test',
});
const pack = JSON.parse(readFileSync('packs/english-demo/pack.json', 'utf8'));
await service.execute('install_pack', { pack });
const goal = await service.execute('create_goal', {
  title: 'libSQL 验证',
  pack_id: pack.manifest.id,
});
const questions = [pack.questions[0], pack.questions.find((q: any) => q.type === 'short_answer')];
const lesson = await service.execute('create_lesson', {
  goal_id: goal.id,
  title: '持久化验收',
  objective: '理解条件句',
  explanation: 'If 指出条件。',
  example: 'If the request fails, retry once.',
  topic_ids: [pack.topics[0].id],
  question_ids: questions.map((q) => q.id),
  idempotency_key: 'test',
});
await service.execute('publish_lesson', { id: lesson.id });
const attempt = await service.execute('start_attempt', {
  lesson_id: lesson.id,
  idempotency_key: 'first',
});
await service.execute('submit_attempt', {
  id: attempt.id,
  expected_version: 0,
  answers: Object.fromEntries(questions.map((q) => [q.id, q.answer])),
});
const review = await service.execute('submit_review', {
  attempt_id: attempt.id,
  idempotency_key: 'r',
  expected_version: 0,
  grades: questions.map((q) => ({ question_id: q.id, score: q.points, feedback: '表达清楚' })),
  summary: '完成',
  next_steps: '复习条件句',
});
const exported = await service.execute('export_data');
await service.execute('validate_import', { bundle: exported });
process.stdout.write(
  JSON.stringify({
    total: review.total,
    max_score: review.max_score,
    attempts: (await service.execute('get_progress'))[0].attempts,
    imported: true,
  }),
);
client.close();
