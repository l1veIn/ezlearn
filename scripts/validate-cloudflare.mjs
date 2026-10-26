// Run against a local Wrangler + D1 instance. It never targets a cloud deployment.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.EZLEARN_TEST_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const endpoint = new URL(base);
assert(
  endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname),
  'Cloudflare 验收仅允许本机 Wrangler 地址，不会向云实例写入数据。',
);
let token = process.env.EZLEARN_API_TOKEN;
if (!token) {
  const vars = await readFile('deploy/cloudflare/.dev.vars', 'utf8');
  token = /^EZLEARN_API_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
}
if (!token) throw new Error('请设置 EZLEARN_API_TOKEN，或在本地 .dev.vars 中提供测试凭证');

const health = await (await fetch(`${base}/health`)).json();
assert.equal(health.product, 'ezlearn');
assert.equal(health.api_version, 1);

async function call(name, input = {}) {
  const response = await fetch(`${base}/api/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  assert(response.ok && result.ok, `HTTP ${name}: ${JSON.stringify(result)}`);
  return result.data;
}

const pack = JSON.parse(await readFile('packs/english-demo/pack.json', 'utf8'));
await call('install_pack', { pack });
const goal = await call('create_goal', { title: 'D1 本地适配验收', pack_id: 'english-demo' });
const nonce = crypto.randomUUID();
const lesson = await call('create_lesson', {
  goal_id: goal.id,
  title: 'D1 真实课程',
  objective: '用 if 描述重试条件',
  explanation: '条件与结果',
  example: 'If a request fails, we will retry.',
  topic_ids: ['condition'],
  question_ids: ['condition-01', 'condition-04'],
  idempotency_key: `d1:${nonce}`,
});
await call('publish_lesson', { id: lesson.id });
const attempt = await call('start_attempt', {
  lesson_id: lesson.id,
  idempotency_key: `d1-attempt:${nonce}`,
});
await call('submit_attempt', {
  id: attempt.id,
  expected_version: attempt.version,
  answers: { 'condition-01': 'A', 'condition-04': 'If the request fails, we will retry.' },
});
const reviewInput = {
  attempt_id: attempt.id,
  expected_version: 0,
  idempotency_key: `d1-review:${nonce}`,
  grades: lesson.questions.map((q) => ({
    question_id: q.id,
    score: q.points,
    feedback: '按参考标准完成。',
  })),
  summary: '理解条件关系。',
  next_steps: '下次复习条件句。',
};
const review = await call('submit_review', reviewInput);
const firstExport = await call('export_data');
const retry = await call('submit_review', reviewInput);
assert.equal(review.id, retry.id);
const progress = await call('get_progress', { goal_id: goal.id });
assert(progress.some((p) => p.attempts > 0));
const bundle = await call('export_data');
assert.equal(bundle.source_revision, firstExport.source_revision, '重复评价不能重复更新进度');
assert(bundle.data.attempts[attempt.id]);
console.log(
  JSON.stringify({
    ok: true,
    runtime: 'workerd + D1 local',
    transport: 'HTTP API',
    api_version: health.api_version,
    lesson_id: lesson.id,
    attempt_id: attempt.id,
    total: review.total,
    max_score: review.max_score,
    revision: bundle.source_revision,
  }),
);
