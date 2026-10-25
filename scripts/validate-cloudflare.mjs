import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
const base = process.env.EZLEARN_TEST_URL || 'http://127.0.0.1:8787';
let token = process.env.EZLEARN_API_TOKEN;
if (!token) {
  const vars = await readFile('deploy/cloudflare/.dev.vars', 'utf8');
  token = /^EZLEARN_API_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
}
if (!token) throw new Error('请设置 EZLEARN_API_TOKEN，或在本地 .dev.vars 中提供测试凭证');
const client = new Client({ name: 'ezlearn-d1-acceptance', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert(!r.isError, JSON.stringify(r));
  assert(r.structuredContent?.ok);
  return r.structuredContent.data;
}
try {
  const tools = await client.listTools();
  assert(tools.tools.some((t) => t.name === 'get_progress'));
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
  const retry = await call('submit_review', reviewInput);
  assert.equal(review.id, retry.id);
  const progress = await call('get_progress', { goal_id: goal.id });
  assert(progress.some((p) => p.attempts > 0));
  const bundle = await call('export_data');
  assert(bundle.data.attempts[attempt.id]);
  console.log(
    JSON.stringify({
      ok: true,
      runtime: 'workerd + D1 local',
      discovered_tools: tools.tools.length,
      lesson_id: lesson.id,
      attempt_id: attempt.id,
      total: review.total,
      max_score: review.max_score,
      revision: bundle.source_revision,
    }),
  );
} finally {
  await client.close();
}
