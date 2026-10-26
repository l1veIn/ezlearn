// Uses the public CLI; no database shortcuts or LLM API are involved.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'dist/cli/index.js');
const dataDir = resolve(process.argv[2] ?? resolve(root, '.ezlearn'));
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:3210';
mkdirSync(dataDir, { recursive: true });
const inputPath = resolve(dataDir, `demo-input-${crypto.randomUUID()}.json`);
function call(operation, input = {}) {
  writeFileSync(inputPath, JSON.stringify(input), 'utf8');
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
    throw new Error(`CLI 未返回 JSON，请先 pnpm build。${result.stderr}`);
  }
  if (result.status !== 0 || !envelope.ok)
    throw new Error(`${envelope.error?.code}: ${envelope.error?.message}`);
  return envelope.data;
}
try {
  const pack = JSON.parse(readFileSync(resolve(root, 'packs/english-demo/pack.json'), 'utf8'));
  call('install_pack', { pack, source: { kind: 'local', url: 'packs/english-demo' } });
  const goals = call('list_goals');
  const goal =
    goals.find(
      (g) =>
        g.title === 'English Demo · 把工作里的小句子说清楚' &&
        g.pack_id === 'english-demo' &&
        g.pack_version === '1.0.0',
    ) ??
    call('create_goal', {
      title: 'English Demo · 把工作里的小句子说清楚',
      pack_id: 'english-demo',
      pack_version: '1.0.0',
      daily_minutes: 15,
      level: 'unknown',
    });
  const lesson = call('create_lesson', {
    goal_id: goal.id,
    title: '如果请求失败，我们就再试一次',
    objective: '用 if + 现在时、will + 动词原形，清楚写出一个未来可能发生的条件和结果。',
    explanation:
      '写重试逻辑时，你会先判断条件，再决定动作。英语也可以这样组织：If the request fails, we will retry it.\n\nIf 从句讲条件，用一般现在时 fails；主句讲未来的结果，用 will retry。即使整句话讨论未来，也不把条件写成 If the request will fail。\n\n先说结果也可以：We will retry the request if it fails. 这时通常不用逗号。今天先把这个小结构写清楚。',
    example:
      '你正在给一个 API 客户端补上超时重试。代码里的条件是 connection.timesOut，动作是 retry(request)。\n\n英文说明：If the connection times out, we will retry the request.\n\n把条件换成 the build fails，结果换成 inspect the logs，就能写另一条工作说明。',
    context_summary: '原创协议演示情境：开发者正在编写 API 超时重试说明，不来自用户历史会话。',
    topic_ids: ['condition'],
    question_ids: ['condition-01', 'condition-02', 'condition-04'],
    kind: 'daily',
    minutes: 15,
    idempotency_key: 'demo:condition:1',
  });
  const published = call('publish_lesson', { id: lesson.id });
  console.log(
    JSON.stringify(
      {
        goal_id: goal.id,
        lesson_id: published.id,
        url: published.url,
        data_dir: dataDir,
        next: '打开链接阅读、保存草稿并提交，再把页面交接提示词发回 Agent。',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    unlinkSync(inputPath);
  } catch {
    /* no temporary file remains */
  }
}
