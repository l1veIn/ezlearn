import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { LearningService } from '../src/core/service.js';
import { createLocalStore } from '../src/storage/local.js';
import { API_VERSION, PLATFORM_VERSION } from '../src/contracts/index.js';

const pack = JSON.parse(readFileSync('packs/english-demo/pack.json', 'utf8'));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture(remote = false) {
  const store = createLocalStore(':memory:');
  cleanups.push(() => store.close?.());
  const token = crypto.randomUUID();
  const secret = crypto.randomUUID();
  const base = 'http://127.0.0.1:3210';
  const service = new LearningService(store, { baseUrl: base, backendId: 'test-http' });
  const app = createApp({
    service,
    mode: remote ? 'remote' : 'local',
    baseUrl: base,
    apiToken: token,
    sessionSecret: secret,
  });
  const rpc = (operation: string, input: unknown = {}, headers: Record<string, string> = {}) =>
    app.request(`/api/rpc/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(input),
    });
  return { app, service, token, store, rpc };
}

describe('统一 HTTP 平台与认证', () => {
  it('通过真实 HTTP API 完成安装、课程、作答、教师阅卷和进度闭环', async () => {
    const { app, token } = fixture();
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const health = await (await fetch(`${endpoint}/health`)).json();
    expect(health).toEqual({
      ok: true,
      product: 'ezlearn',
      version: PLATFORM_VERSION,
      api_version: API_VERSION,
    });
    async function call(operation: string, input: unknown = {}, teacher = true) {
      const response = await fetch(`${endpoint}/api/rpc/${operation}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(teacher ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });
      const result = (await response.json()) as { ok: boolean; data: any; error?: unknown };
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.ok).toBe(true);
      return result.data;
    }
    await call('install_pack', { pack });
    const goal = await call('create_goal', { title: 'HTTP 工作英语', pack_id: 'english-demo' });
    const lesson = await call('create_lesson', {
      goal_id: goal.id,
      title: '条件与重试',
      objective: '表达条件',
      explanation: 'If 从句使用现在时。',
      example: 'If the request fails, we will retry.',
      topic_ids: ['condition'],
      question_ids: ['condition-01', 'condition-04'],
      idempotency_key: 'http-course',
    });
    await call('publish_lesson', { id: lesson.id });
    expect(
      (await call('get_lesson', { id: lesson.id, teacher: true }, false)).questions[0].answer,
    ).toBeUndefined();
    const attempt = await call(
      'start_attempt',
      { lesson_id: lesson.id, idempotency_key: 'web-first' },
      false,
    );
    const submitted = await call(
      'submit_attempt',
      {
        id: attempt.id,
        expected_version: 0,
        answers: {
          'condition-01': 'B',
          'condition-04': 'If the connection times out, we will retry the request.',
        },
      },
      false,
    );
    expect(submitted.status).toBe('submitted');
    expect(submitted.handoff_prompt).toContain(attempt.id);
    expect((await call('list_pending_attempts'))[0].id).toBe(attempt.id);
    const teacherView = await call('get_attempt', { id: attempt.id, teacher: true });
    expect(teacherView.lesson.questions[0].answer).toBe('A');
    const reviewInput = {
      attempt_id: attempt.id,
      expected_version: 0,
      idempotency_key: 'http-review',
      grades: lesson.questions.map((q: any) => ({
        question_id: q.id,
        score: q.points,
        feedback: '逐题反馈',
      })),
      summary: '完成本轮',
      next_steps: '巩固条件从句',
    };
    const review = await call('submit_review', reviewInput);
    expect(review.total).toBe(4);
    expect(review.max_score).toBe(6);
    expect(await call('submit_review', reviewInput)).toEqual(review);
    expect(
      (await call('get_progress', { goal_id: goal.id })).find(
        (p: any) => p.topic_id === 'condition',
      ).attempts,
    ).toBe(2);
    expect((await call('get_attempt', { id: attempt.id }, false)).review.id).toBe(review.id);
    expect((await fetch(`${endpoint}/mcp`, { method: 'POST' })).status).toBe(404);
  });

  it('本地伪造 Bearer 不能读取答案或冒充老师，真实凭证与浏览器职责分离', async () => {
    const { app, service, token, rpc } = fixture();
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
      idempotency_key: 'local-auth',
    });
    await service.execute('publish_lesson', { id: lesson.id });
    expect(
      (
        await rpc(
          'get_lesson',
          { id: lesson.id, teacher: true },
          { Authorization: 'Bearer forged-local-token' },
        )
      ).status,
    ).toBe(401);
    expect((await rpc('create_lesson', {}, {})).status).toBe(403);
    expect((await rpc('submit_review', {}, {})).status).toBe(403);
    const learner = (await (
      await rpc('get_lesson', { id: lesson.id, teacher: true })
    ).json()) as any;
    expect(learner.data.questions[0].answer).toBeUndefined();
    const teacher = (await (
      await rpc(
        'get_lesson',
        { id: lesson.id, teacher: true },
        { Authorization: `Bearer ${token}` },
      )
    ).json()) as any;
    expect(teacher.data.questions[0].answer).toBe('A');
    const metadata = await (await app.request('/api/platform')).json();
    expect(JSON.stringify(metadata)).not.toContain(token);
    expect((metadata as any).data.capabilities).toContain('packs.github');
    expect((metadata as any).data.teacher_authenticated).toBe(false);
    const teacherMetadata = (await (
      await app.request('/api/platform', { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as any;
    expect(teacherMetadata.data.teacher_authenticated).toBe(true);
    expect((await app.request('http://untrusted.example/api/dashboard')).status).toBe(403);
  });

  it('远端登录会话可管理包，教师操作仍需 Bearer，跨站请求被拒绝', async () => {
    const { app, token, rpc } = fixture(true);
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
    const headers = { Cookie: cookie };
    const installed = (await (
      await rpc('install_pack', { pack, source: { kind: 'local', url: 'browser-upload' } }, headers)
    ).json()) as any;
    expect(installed.ok).toBe(true);
    expect(installed.data.pack.questions).toBeUndefined();
    const one = (await (await rpc('get_pack', { id: 'english-demo' }, headers)).json()) as any;
    expect(one.data.pack.questions).toBeUndefined();
    const all = (await (await rpc('list_packs', {}, headers)).json()) as any;
    expect(all.data[0].pack.questions).toBeUndefined();
    expect((await rpc('submit_review', {}, headers)).status).toBe(403);
    expect(
      (
        await app.request('/api/logout', {
          method: 'POST',
          headers: { Origin: 'https://evil.example', Cookie: cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/packs/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repository: 'https://github.com/acme/english-demo',
            ref: 'v1.0.0',
          }),
        })
      ).status,
    ).toBe(401);
  });

  it('平台在服务器解析 GitHub ref，校验不写入，安装保存准确版本并隐藏题库', async () => {
    const { app, service } = fixture();
    const sha = 'a'.repeat(40);
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('api.github.com/')) return Response.json({ sha });
        if (url === `https://raw.githubusercontent.com/acme/english-demo/${sha}/pack.json`)
          return Response.json(pack);
        throw new Error(`unexpected request ${url}`);
      }),
    );
    const install = (input: unknown) =>
      app.request('/api/packs/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    const checked = (await (
      await install({
        repository: 'https://github.com/acme/english-demo',
        ref: 'v1.0.0',
        validate_only: true,
      })
    ).json()) as any;
    expect(checked.data.valid).toBe(true);
    expect((await service.execute('list_packs')).length).toBe(0);
    const response = await install({
      repository: 'https://github.com/acme/english-demo',
      ref: 'v1.0.0',
    });
    expect(response.status).toBe(200);
    const installed = (await response.json()) as any;
    expect(installed.data.source.resolved).toBe(sha);
    expect(installed.data.source.ref).toBe('v1.0.0');
    expect(installed.data.pack.questions).toBeUndefined();
    expect(urls[0]).toBe('https://api.github.com/repos/acme/english-demo/commits/v1.0.0');
    const stored = await service.execute('get_pack', { id: 'english-demo' });
    expect(stored.pack.questions).toHaveLength(16);
    expect(
      (await install({ repository: 'https://github.com/acme/english-demo', ref: '' })).status,
    ).toBe(400);
  });

  it('Web 上传损坏包被原子拒绝，同版本覆盖被拒绝，新增版本保留旧内容', async () => {
    const { service, rpc } = fixture();
    const before = await service.execute('get_status');
    const invalid = structuredClone(pack);
    invalid.questions[0].topic_ids = ['missing-topic'];
    expect((await rpc('install_pack', { pack: invalid })).status).toBe(400);
    expect((await service.execute('get_status')).revision).toBe(before.revision);
    expect((await rpc('validate_pack', { pack })).status).toBe(200);
    expect((await service.execute('list_packs')).length).toBe(0);
    expect((await rpc('install_pack', { pack })).status).toBe(200);
    const changed = structuredClone(pack);
    changed.questions[0].prompt = '新题目';
    expect((await rpc('install_pack', { pack: changed })).status).toBe(409);
    changed.manifest.version = '1.1.0';
    expect((await rpc('install_pack', { pack: changed })).status).toBe(200);
    expect(
      (await service.execute('get_pack', { id: 'english-demo', version: '1.0.0' })).pack
        .questions[0].prompt,
    ).toBe(pack.questions[0].prompt);
  });
});
