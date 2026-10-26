// Full browser + public CLI acceptance. Uses a fresh ignored database on every run.
import { chromium, expect } from 'playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const area = resolve(root, '.tmp/browser-acceptance');
const runId = crypto.randomUUID();
const dataDir = resolve(area, `data-${runId}`);
const screenshots = resolve(area, 'screenshots');
const baseUrl = 'http://127.0.0.1:3212';
const cli = resolve(root, 'dist/cli/index.js');
const platform = resolve(root, 'dist/platform/index.js');
await mkdir(dataDir, { recursive: true });
await mkdir(screenshots, { recursive: true });
const inputPath = resolve(dataDir, 'input.json');
const logs = [];
let server;
let browser;
const errors = [];

async function call(operation, input = {}) {
  await writeFile(inputPath, JSON.stringify(input), 'utf8');
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'call',
      operation,
      '--input',
      inputPath,
      '--json',
      '--data-dir',
      dataDir,
      '--endpoint',
      baseUrl,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  let envelope;
  try {
    envelope = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`CLI ${operation} 未返回JSON: ${result.stderr}`);
  }
  assert(result.status === 0 && envelope.ok, `CLI ${operation}: ${JSON.stringify(envelope)}`);
  return envelope.data;
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
  server = undefined;
}
async function startServer() {
  server = spawn(
    process.execPath,
    [platform, '--data-dir', dataDir, '--port', '3212', '--base-url', baseUrl],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  let launchError;
  server.on('error', (error) => {
    launchError = error;
  });
  for (let retry = 0; retry < 100; retry++) {
    if (launchError) throw launchError;
    if (server.exitCode !== null) throw new Error(`验收服务启动失败：${logs.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('验收服务没有就绪');
}

try {
  // Never attach the regression to an already running instance or its data.
  let occupied = false;
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    occupied = true;
  } catch {}
  assert(!occupied, '3212 端口已在使用。请先停止该端口的服务后重试；脚本不会操作现有实例。');
  await startServer();
  const channel =
    process.env.EZLEARN_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));

  // The independent Web platform installs content without a CLI or teacher token.
  await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' });
  await page
    .getByLabel('选择学习包 JSON', { exact: true })
    .setInputFiles(resolve(root, 'packs/english-demo/pack.json'));
  await page.getByRole('button', { name: '校验上传的学习包', exact: true }).click();
  await page.getByRole('button', { name: '安装上传的学习包', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '已安装 english-demo@1.0.0。' }),
  ).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(screenshots, 'packs.png'), fullPage: true });

  // CLI is an HTTP client. The platform must be running before seeding.
  const prepared = spawnSync(
    process.execPath,
    [resolve(root, 'examples/prepare-demo.mjs'), dataDir, baseUrl],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(prepared.status, 0, `prepare-demo 失败：${prepared.stderr}`);
  const demo = JSON.parse(prepared.stdout);

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /每天一点，\s*慢慢学会。/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '继续这一课' })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'home.png'), fullPage: true });
  await page.getByRole('link', { name: '继续这一课' }).click();
  await expect(page).toHaveURL(`${baseUrl}/lessons/${demo.lesson_id}`);
  await expect(page.getByRole('heading', { name: '如果请求失败，我们就再试一次' })).toBeVisible();

  const answers = {
    'condition-01': 'A',
    'condition-02': 'B',
    'condition-04': 'If the connection times out, we will retry the request.',
  };
  await page.locator('input[name="condition-01"][value="A"]').check();
  await page.locator('input[name="condition-02"][value="B"]').check();
  await page.getByRole('textbox', { name: '第 3 题答案' }).fill(answers['condition-04']);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存于', { exact: false })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('input[name="condition-01"][value="A"]')).toBeChecked();
  await expect(page.locator('input[name="condition-02"][value="B"]')).toBeChecked();
  await expect(page.getByRole('textbox', { name: '第 3 题答案' })).toHaveValue(
    answers['condition-04'],
  );
  await page.getByRole('button', { name: '完成，交给老师' }).click();
  await page.waitForURL(/\/attempts\/attempt_/);
  await expect(page.getByText('已提交，待老师反馈。', { exact: false })).toBeVisible();
  const attemptId = new URL(page.url()).pathname.split('/').at(-1);
  const handoff = await page.locator('.handoff-text').innerText();
  assert(handoff.includes(attemptId), '交接提示词缺少准确 attempt_id');
  assert(handoff.includes(baseUrl), '交接提示词缺少准确后端地址');
  await page.getByRole('button', { name: '复制提示词，继续学习', exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    handoff,
    '剪贴板提示词与页面不一致',
  );
  const detail = await call('get_attempt', { id: attemptId, teacher: true });
  assert.equal(detail.attempt.status, 'submitted');
  assert.deepEqual(detail.attempt.answers, answers, 'CLI未读到浏览器真实提交');
  const review = await call('submit_review', {
    attempt_id: attemptId,
    expected_version: 0,
    idempotency_key: `browser-review:${runId}`,
    grades: [
      { question_id: 'condition-01', score: 2, feedback: '你正确使用了 if 从句的一般现在时。' },
      {
        question_id: 'condition-02',
        score: 2,
        feedback:
          '这里选择了 B。条件从句不用 will fail；正确表达是 If the build fails, we will inspect the logs. 客观题得分由平台按答案键计算。',
      },
      {
        question_id: 'condition-04',
        score: 4,
        feedback:
          '四项 rubric 均满足：超时作为条件、if 从句现在时、主句 will + 动词、完整表达重试请求。',
      },
    ],
    summary:
      '你已能写出完整的条件句。这轮 3 道题中，独立表达正确；辨认条件从句时态还需要再练一次。',
    next_steps: '下一轮先巩固条件句：比较 if 与 when，再把两个工作条件改写成英文。',
  });
  assert.equal(review.total, 6);
  assert.equal(review.max_score, 8);
  await page.getByRole('button', { name: '老师已反馈？刷新结果' }).click();
  await expect(page.locator('.score strong')).toHaveText('6');
  await expect(page.locator('.score > span')).toHaveText('/ 8');
  await expect(page.getByText('反馈版本 1')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'result.png'), fullPage: true });

  // A fresh server process reads the exact same result from SQLite.
  await stopServer();
  await startServer();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.score strong')).toHaveText('6');
  const plan = await call('plan_next_session', { goal_id: demo.goal_id });
  assert.equal(plan.action, 'study');
  assert.equal(plan.topic.id, 'condition');
  const next = await call('create_lesson', {
    goal_id: demo.goal_id,
    title: '先分清 if 和 when，再写一个条件句',
    objective: '区分尚不确定的条件与预期发生的时间节点。',
    explanation:
      'If the build finishes, we may read the report. 强调是否完成尚不确定。When the build finishes, we will read the report. 把完成当作预期发生的时间节点。',
    example: '等待构建时，用 when 说明接下来读报告；描述可能超时的连接时，用 if 说明重试条件。',
    context_summary: '浏览器协议验收原创情境，不来自用户会话。',
    topic_ids: ['condition'],
    question_ids: ['condition-03', 'condition-04'],
    minutes: 10,
    idempotency_key: `browser-next:${runId}`,
  });
  await call('publish_lesson', { id: next.id });
  const continuation = await call('plan_next_session', { goal_id: demo.goal_id });
  assert.equal(continuation.action, 'resume');
  assert.equal(continuation.lesson.id, next.id);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: next.title })).toBeVisible();
  await page.getByRole('link', { name: '继续这一课' }).click();
  await expect(page).toHaveURL(`${baseUrl}/lessons/${next.id}`);
  await expect(page.getByRole('heading', { name: next.title })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'continuation.png'), fullPage: true });
  assert.deepEqual(errors, [], '浏览器发生脚本错误');
  const report = {
    ok: true,
    browser: 'Microsoft Edge / Playwright',
    viewport: '1440x1000',
    data_dir: dataDir,
    goal_id: demo.goal_id,
    lesson_id: demo.lesson_id,
    attempt_id: attemptId,
    total: review.total,
    max_score: review.max_score,
    next_lesson_id: next.id,
    checks: [
      'home',
      'independent_platform_start',
      'web_pack_upload_validation_install',
      'lesson',
      'save_draft',
      'reload_restore',
      'submit',
      'handoff_id_and_backend',
      'clipboard',
      'cli_review',
      'objective_score_protection',
      'result',
      'restart_persistence',
      'weak_topic_plan',
      'published_continuation',
    ],
    screenshots: {
      home: resolve(screenshots, 'home.png'),
      packs: resolve(screenshots, 'packs.png'),
      result: resolve(screenshots, 'result.png'),
      continuation: resolve(screenshots, 'continuation.png'),
    },
  };
  await writeFile(resolve(area, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopServer();
  await writeFile(resolve(area, 'server.log'), logs.join(''), 'utf8');
}
