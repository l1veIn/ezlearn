import { afterEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { LearningService } from '../src/core/service.js';
import { createLocalStore } from '../src/storage/local.js';

const pack = JSON.parse(readFileSync('packs/english-demo/pack.json', 'utf8'));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
async function fixture(remote = false) {
  const store = createLocalStore(':memory:');
  cleanups.push(() => store.close?.());
  const token = crypto.randomUUID();
  const secret = crypto.randomUUID();
  const base = 'http://127.0.0.1:3210';
  const service = new LearningService(store, { baseUrl: base, backendId: 'test-transport' });
  const app = createApp({
    service,
    mode: remote ? 'remote' : 'local',
    baseUrl: base,
    apiToken: token,
    sessionSecret: secret,
  });
  return { app, service, token, store };
}
describe('真实传输与认证', () => {
  it('官方 MCP 客户端发现工具并完成课程、提交、阅卷闭环', async () => {
    const { app, service } = await fixture();
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const client = new Client({ name: 'ezlearn-acceptance', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)),
    );
    cleanups.push(() => client.close());
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'submit_review')).toBe(true);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const value = result.structuredContent as { ok: boolean; data: any };
      expect(value.ok).toBe(true);
      return value.data;
    }
    await call('install_pack', { pack });
    const goal = await call('create_goal', { title: '英语工作表达', pack_id: 'english-demo' });
    expect((await call('get_progress', { goal_id: goal.id })).length).toBe(4);
    const lesson = await call('create_lesson', {
      goal_id: goal.id,
      title: '重试与条件',
      objective: '用 if 表达真实条件',
      explanation: 'If 从句说明条件，主句说明结果。',
      example: 'If the request fails, we will retry.',
      topic_ids: ['condition'],
      question_ids: ['condition-01', 'condition-04'],
      idempotency_key: 'mcp-course-1',
    });
    await call('publish_lesson', { id: lesson.id });
    const attempt = await service.execute('start_attempt', {
      lesson_id: lesson.id,
      idempotency_key: 'web-first',
    });
    const submitted = await service.execute('submit_attempt', {
      id: attempt.id,
      expected_version: attempt.version,
      answers: { 'condition-01': 'A', 'condition-04': 'If the request fails, we will retry.' },
    });
    const pending = await call('list_pending_attempts');
    expect(pending[0].id).toBe(attempt.id);
    expect(
      (await call('get_attempt', { id: attempt.id })).lesson.questions[0].answer,
    ).toBeDefined();
    const review = await call('submit_review', {
      attempt_id: attempt.id,
      expected_version: 0,
      idempotency_key: 'mcp-review-1',
      grades: lesson.questions.map((q: any) => ({
        question_id: q.id,
        score: q.points,
        feedback: '结构清晰。',
      })),
      summary: '理解真实条件',
      next_steps: '复习条件和结果。',
    });
    expect(review.total).toBeGreaterThan(0);
    expect((await call('list_pending_attempts')).length).toBe(0);
    const progress = await call('get_progress', { goal_id: goal.id });
    expect(progress.find((p: any) => p.topic_id === 'condition').attempts).toBeGreaterThan(0);
    expect(submitted.handoff_prompt).toContain(attempt.id);
  });
  it('远端会话、Bearer 教师权限和浏览器答案隔离', async () => {
    const { app, service, token } = await fixture(true);
    await service.execute('install_pack', { pack });
    const goal = await service.execute('create_goal', { title: '测试', pack_id: 'english-demo' });
    const lesson = await service.execute('create_lesson', {
      goal_id: goal.id,
      title: '测试',
      objective: '条件句',
      explanation: '说明',
      example: 'If A, B.',
      topic_ids: ['condition'],
      question_ids: ['condition-01'],
      idempotency_key: 'remote-test',
    });
    await service.execute('publish_lesson', { id: lesson.id });
    expect((await app.request('/api/dashboard')).status).toBe(401);
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const rpc = async (
      operation: string,
      input: unknown,
      auth: Record<string, string> = { Cookie: cookie },
    ) =>
      app.request(`/api/rpc/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(input),
      });
    const learner = (await (await rpc('get_lesson', { id: lesson.id, teacher: true })).json()) as {
      data: { questions: { answer?: string }[] };
    };
    expect(learner.data.questions[0].answer).toBeUndefined();
    const packList = (await (await rpc('list_packs', {})).json()) as {
      data: { pack: { questions?: unknown } }[];
    };
    expect(packList.data[0].pack.questions).toBeUndefined();
    expect((await rpc('submit_review', {})).status).toBe(403);
    const teacher = (await (
      await rpc('get_lesson', { id: lesson.id }, { Authorization: `Bearer ${token}` })
    ).json()) as { data: { questions: { answer?: string }[] } };
    expect(teacher.data.questions[0].answer).toBeDefined();
    const evil = await app.request('/api/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Cookie: cookie },
    });
    expect(evil.status).toBe(403);
    expect(
      (
        await app.request('/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
  });
});
