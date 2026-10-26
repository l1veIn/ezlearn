import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createServer } from 'node:net';

const root = resolve('.');
const testRoot = mkdtempSync(join(tmpdir(), 'ezlearn-cli-http-'));
const configDir = join(testRoot, 'client');
const clientDataDir = join(testRoot, 'client-data');
const envA = crypto.randomUUID() + crypto.randomUUID();
const envB = crypto.randomUUID() + crypto.randomUUID();
const env = {
  ...process.env,
  EZLEARN_API_TOKEN: undefined,
  EZLEARN_TEST_TOKEN_A: envA,
  EZLEARN_TEST_TOKEN_B: envB,
  EZLEARN_TEST_WRONG_TOKEN: crypto.randomUUID(),
};
const children = new Set<ChildProcess>();
type Instance = { endpoint: string; dataDir: string; port: number; child: ChildProcess };
let a: Instance;
let b: Instance;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法保留测试端口');
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function startInstance(name: string, token: string, port?: number): Promise<Instance> {
  const actualPort = port ?? (await freePort());
  const endpoint = `http://127.0.0.1:${actualPort}`;
  const dataDir = join(testRoot, name);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/platform/index.ts',
      '--data-dir',
      dataDir,
      '--port',
      String(actualPort),
      '--base-url',
      endpoint,
    ],
    {
      cwd: root,
      windowsHide: true,
      env: { ...env, EZLEARN_API_TOKEN: token, EZLEARN_SESSION_SECRET: crypto.randomUUID() },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  let logs = '';
  let launchError: Error | undefined;
  child.stdout?.on('data', (chunk) => (logs += chunk.toString()));
  child.stderr?.on('data', (chunk) => (logs += chunk.toString()));
  child.on('error', (error) => (launchError = error));
  for (let retry = 0; retry < 100; retry++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`独立平台启动失败：${logs}`);
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(300) });
      const health = (await response.json()) as { product?: string };
      if (
        response.ok &&
        health.product === 'ezlearn' &&
        existsSync(join(dataDir, 'connection.json'))
      )
        return { endpoint, dataDir, port: actualPort, child };
    } catch {
      // Wait for the independent platform process, never initialize its DB from the test client.
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`独立平台未就绪：${logs}`);
}

async function stopInstance(instance: Instance) {
  if (instance.child.exitCode === null) {
    await new Promise<void>((done) => {
      instance.child.once('exit', () => done());
      instance.child.kill();
    });
  }
  children.delete(instance.child);
}

function cliRaw(
  args: string[],
  input?: object,
  config = configDir,
  extraEnv: Record<string, string | undefined> = {},
) {
  const flags = ['--json', '--config-dir', config, '--data-dir', clientDataDir];
  if (input) {
    mkdirSync(config, { recursive: true });
    const path = join(config, `input-${crypto.randomUUID()}.json`);
    writeFileSync(path, JSON.stringify(input));
    flags.push('--input', path);
  }
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli/index.ts', ...args, ...flags],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, EZLEARN_ENDPOINT: undefined, EZLEARN_BASE_URL: undefined, ...extraEnv },
      windowsHide: true,
      timeout: 15000,
    },
  );
  if (result.error) throw result.error;
  let resultData: any;
  try {
    resultData = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`CLI 未返回单个 JSON：${result.stderr}`);
  }
  expect(result.stdout).not.toContain(envA);
  expect(result.stdout).not.toContain(envB);
  return { ...result, result: resultData };
}

function cli(args: string[], input?: object, config = configDir): any {
  const result = cliRaw(args, input, config);
  expect(result.status, JSON.stringify(result.result)).toBe(0);
  expect(result.result.ok, JSON.stringify(result.result)).toBe(true);
  return result.result.data;
}

beforeAll(async () => {
  a = await startInstance('platform-a', envA);
  b = await startInstance('platform-b', envB);
}, 20000);

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      await new Promise<void>((done) => {
        child.once('exit', () => done());
        child.kill();
      });
    }
  }
  // This path was created with mkdtemp inside the dedicated OS temp directory.
  if (!resolve(testRoot).startsWith(resolve(tmpdir()) + sep)) throw new Error('测试清理路径越界');
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

describe('独立平台与真实 HTTP CLI', () => {
  it('命名端点可切换，HTTP 教学与迁移闭环不在客户端创建数据库', async () => {
    cli(['profile', 'set', '--name', 'a'], {
      endpoint: a.endpoint,
      connection_file: join(a.dataDir, 'connection.json'),
    });
    cli(['profile', 'set', '--name', 'b'], {
      endpoint: b.endpoint,
      token_env: 'EZLEARN_TEST_TOKEN_B',
    });
    cli(['profile', 'use', 'a']);
    expect(cli(['profile', 'show']).name).toBe('a');
    expect(cli(['profile', 'list']).some((p: any) => p.name === 'a' && p.current)).toBe(true);
    expect(cli(['status']).base_url).toBe(a.endpoint);
    const doctor = cli(['platform', 'doctor']);
    expect(doctor.healthy).toBe(true);
    expect(doctor.checks.authentication).toBe(true);
    expect(doctor.platform.teacher_authenticated).toBe(true);
    expect(cli(['status', '--profile', 'b']).base_url).toBe(b.endpoint);
    expect(cli(['profile', 'show']).name).toBe('a');

    const pack = JSON.parse(readFileSync(join(root, 'packs/english-demo/pack.json'), 'utf8'));
    cli(['pack', 'install', join(root, 'packs/english-demo')]);
    expect(cli(['pack', 'list'])).toHaveLength(1);
    cli(['profile', 'use', 'b']);
    expect(cli(['pack', 'list'])).toHaveLength(0);
    cli(['profile', 'use', 'a']);

    const goal = cli(['goal', 'create'], { title: 'HTTP 条件句学习', pack_id: pack.manifest.id });
    const lesson = cli(['lesson', 'create'], {
      goal_id: goal.id,
      title: '独立平台上的条件句',
      objective: '用 if 描述条件',
      explanation: '条件从句使用一般现在时，主句说明后续动作。',
      example: 'If the build fails, we will inspect the logs.',
      topic_ids: ['condition'],
      question_ids: ['condition-01', 'condition-04'],
      idempotency_key: 'http-cli-course',
    });
    cli(['lesson', 'publish', lesson.id]);
    const attempt = cli(['attempt', 'start'], {
      lesson_id: lesson.id,
      idempotency_key: 'http-cli-attempt',
    });
    cli(['attempt', 'submit'], {
      id: attempt.id,
      expected_version: 0,
      answers: {
        'condition-01': 'A',
        'condition-04': 'If the connection times out, we will retry.',
      },
    });
    expect(cli(['attempt', 'pending'])[0].id).toBe(attempt.id);
    const teacherView = cli(['attempt', 'show', attempt.id]);
    expect(teacherView.lesson.questions[0].answer).toBe('A');
    const reviewInput = {
      attempt_id: attempt.id,
      expected_version: 0,
      idempotency_key: 'http-cli-review',
      grades: teacherView.lesson.questions.map((q: any) => ({
        question_id: q.id,
        score: q.type === 'single_choice' ? 0 : q.points,
        feedback: '按题目标准完成。',
      })),
      summary: '本轮完成',
      next_steps: '下次继续条件与结果练习',
    };
    const review = cli(['review', 'submit'], reviewInput);
    expect(review.total).toBe(6);
    expect(cli(['review', 'submit'], reviewInput).id).toBe(review.id);
    expect(cli(['progress', '--goal', goal.id])[0].attempts).toBe(2);

    const exported = cli(['export']);
    expect(exported.data.reviews[review.id].total).toBe(6);
    cli(['profile', 'use', 'b']);
    expect(cli(['pack', 'list'])).toHaveLength(0);
    const imported = cli(['import'], exported);
    expect(imported.imported).toBe(true);
    expect(cli(['attempt', 'show', attempt.id]).review.total).toBe(6);
    expect(cli(['lesson', 'show', lesson.id]).url).toBe(`${b.endpoint}/lessons/${lesson.id}`);

    const persistedInstanceId = cli(['status']).backend_id;
    await stopInstance(b);
    b = await startInstance('platform-b', envB, b.port);
    expect(cli(['status']).backend_id).toBe(persistedInstanceId);
    expect(cli(['attempt', 'show', attempt.id]).review.total).toBe(6);
    expect(existsSync(join(configDir, 'learning.sqlite'))).toBe(false);
    expect(existsSync(join(clientDataDir, 'learning.sqlite'))).toBe(false);
  }, 45000);

  it('服务停止时明确失败，不回退数据库；错误教师凭证不能导出学习数据', async () => {
    const deadEndpoint = `http://127.0.0.1:${await freePort()}`;
    cli(['profile', 'set', '--name', 'offline'], {
      endpoint: deadEndpoint,
      token_env: 'EZLEARN_TEST_TOKEN_A',
    });
    const unreachable = cliRaw(['status', '--profile', 'offline']);
    expect(unreachable.status).not.toBe(0);
    expect(unreachable.result.error.code).toBe('PLATFORM_UNREACHABLE');
    expect(unreachable.result.error.message).toMatch(/start|启动/);
    cli(['profile', 'set', '--name', 'wrong'], {
      endpoint: a.endpoint,
      token_env: 'EZLEARN_TEST_WRONG_TOKEN',
    });
    const denied = cliRaw(['export', '--profile', 'wrong']);
    expect(denied.status).not.toBe(0);
    expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(denied.result.error.code);
    cli(['profile', 'set', '--name', 'anonymous'], { endpoint: a.endpoint });
    const unauthenticatedDoctor = cliRaw(['platform', 'doctor', '--profile', 'anonymous']);
    expect(unauthenticatedDoctor.status).not.toBe(0);
    expect(unauthenticatedDoctor.result.error.code).toBe('MISSING_CREDENTIAL');
    expect(existsSync(join(clientDataDir, 'learning.sqlite'))).toBe(false);
  });

  it('旧 profile 迁移为统一端点配置并保留旧文件', () => {
    const legacyLocal = join(testRoot, 'legacy-local');
    mkdirSync(legacyLocal);
    const legacyPath = join(legacyLocal, 'profile.json');
    writeFileSync(legacyPath, JSON.stringify({ kind: 'local' }));
    const local = cli(['profile', 'show'], undefined, legacyLocal);
    expect(local.endpoint).toBe('http://127.0.0.1:3210');
    expect(existsSync(join(legacyLocal, 'profiles.json'))).toBe(true);
    expect(JSON.parse(readFileSync(legacyPath, 'utf8'))).toEqual({ kind: 'local' });

    const legacyRemote = join(testRoot, 'legacy-remote');
    mkdirSync(legacyRemote);
    writeFileSync(
      join(legacyRemote, 'profile.json'),
      JSON.stringify({ kind: 'remote', url: b.endpoint, token_env: 'EZLEARN_TEST_TOKEN_B' }),
    );
    expect(cli(['status'], undefined, legacyRemote).base_url).toBe(b.endpoint);
    expect(cli(['profile', 'show'], undefined, legacyRemote).endpoint).toBe(b.endpoint);
    expect(existsSync(join(legacyRemote, 'learning.sqlite'))).toBe(false);
    const broken = join(testRoot, 'legacy-broken');
    mkdirSync(broken);
    writeFileSync(join(broken, 'profile.json'), JSON.stringify({ kind: 'remote' }));
    const rejected = cliRaw(['profile', 'show'], undefined, broken);
    expect(rejected.result.error.code).toBe('INVALID_PROFILE');
    expect(existsSync(join(broken, 'profiles.json'))).toBe(false);
  });

  it('覆盖端点不会携带原 profile 的凭证，新的凭证引用必须显式指定', () => {
    const explicitProfile = cliRaw(['status', '--profile', 'a'], undefined, configDir, {
      EZLEARN_ENDPOINT: b.endpoint,
    });
    expect(explicitProfile.result.data.base_url).toBe(a.endpoint);
    const withoutCredential = cliRaw(['export', '--profile', 'a', '--endpoint', b.endpoint]);
    expect(withoutCredential.status).not.toBe(0);
    expect(withoutCredential.result.error.code).toBe('FORBIDDEN');
    const explicit = cli([
      'export',
      '--profile',
      'a',
      '--endpoint',
      b.endpoint,
      '--token-env',
      'EZLEARN_TEST_TOKEN_B',
    ]);
    expect(explicit.format).toBe('ezlearn-export');
  });

  it('旧版或错误服务端明确返回 API 不兼容，不发送学习命令', async () => {
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      ['tests/helpers/incompatible-platform.mjs', String(port)],
      {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.add(child);
    let ready = false;
    for (let retry = 0; retry < 50; retry++) {
      try {
        ready = (await fetch(`${endpoint}/health`)).ok;
        if (ready) break;
      } catch {}
      await new Promise((done) => setTimeout(done, 30));
    }
    expect(ready).toBe(true);
    cli(['profile', 'set', '--name', 'incompatible'], {
      endpoint,
      token_env: 'EZLEARN_TEST_TOKEN_A',
    });
    const incompatible = cliRaw(['goal', 'list', '--profile', 'incompatible']);
    expect(incompatible.status).not.toBe(0);
    expect(incompatible.result.error.code).toBe('INCOMPATIBLE_API');
    expect(await (await fetch(`${endpoint}/counts`)).json()).toEqual({
      rpc_requests: 0,
      authenticated_requests: 0,
    });
  });
});
