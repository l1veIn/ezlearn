#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { LearningService } from '../core/service.js';
import { createLocalStore } from '../storage/local.js';
import { AppError, errorResult, operations, type Operation } from '../contracts/index.js';
import { createApp } from '../server/app.js';
import { loadGithubPack } from '../server/pack-loader.js';
import { loadLocalPack } from './pack-loader.js';

interface Profile {
  kind: 'local' | 'remote';
  url?: string;
  token_env?: string;
  backend_id?: string;
}
const booleans = new Set(['json', 'validate', 'help']);
const positional: string[] = [];
const flags: Record<string, string | boolean> = {};
let parseError: AppError | undefined;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq < 0 ? undefined : eq);
    if (booleans.has(key)) flags[key] = true;
    else if (eq >= 0) flags[key] = arg.slice(eq + 1);
    else {
      const next = process.argv[++i];
      if (!next || next.startsWith('--')) {
        parseError = new AppError('INVALID_ARGUMENT', `--${key} 需要值`);
        break;
      }
      flags[key] = next;
    }
  } else positional.push(arg);
}
const stringFlag = (name: string) =>
  typeof flags[name] === 'string' ? (flags[name] as string) : undefined;
const dataDir = resolve(stringFlag('data-dir') || process.env.EZLEARN_DATA_DIR || '.ezlearn');
const profilePath = resolve(dataDir, 'profile.json');
function output(data: unknown) {
  process.stdout.write(JSON.stringify({ ok: true, data }, null, flags.json ? undefined : 2) + '\n');
}
async function inputFile(): Promise<Record<string, unknown>> {
  const path = stringFlag('input');
  if (!path) return {};
  let text: string;
  if (path === '-') {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > 2_000_000) throw new AppError('PAYLOAD_TOO_LARGE', '输入不能超过2MB');
      chunks.push(part);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    const info = await stat(resolve(path));
    if (info.size > 2_000_000) throw new AppError('PAYLOAD_TOO_LARGE', '输入文件不能超过2MB');
    text = await readFile(resolve(path), 'utf8');
  }
  if (Buffer.byteLength(text) > 2_000_000)
    throw new AppError('PAYLOAD_TOO_LARGE', '输入文件不能超过2MB');
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AppError('INVALID_JSON', '输入文件需要有效 JSON 对象');
  }
}
async function readProfile(): Promise<Profile> {
  try {
    const raw = JSON.parse(await readFile(profilePath, 'utf8'));
    if (raw.kind !== 'local' && raw.kind !== 'remote') throw new Error();
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'local' };
    throw new AppError('INVALID_PROFILE', 'profile 格式错误，请用 profile set 重新配置');
  }
}
const mappings: Record<string, Operation> = {
  status: 'get_status',
  'pack list': 'list_packs',
  'pack show': 'get_pack',
  'goal create': 'create_goal',
  'goal list': 'list_goals',
  'goal show': 'get_goal',
  'goal update': 'update_goal',
  'material search': 'search_materials',
  progress: 'get_progress',
  'review due': 'get_due_reviews',
  'plan next': 'plan_next_session',
  'lesson create': 'create_lesson',
  'lesson publish': 'publish_lesson',
  'lesson show': 'get_lesson',
  'attempt start': 'start_attempt',
  'attempt draft': 'save_draft',
  'attempt submit': 'submit_attempt',
  'attempt pending': 'list_pending_attempts',
  'attempt show': 'get_attempt',
  'review submit': 'submit_review',
  export: 'export_data',
  import: 'import_data',
};
const help = `ezlearn v0.1 — 你的 Agent，带你每天学一点\n\n从源码：pnpm build；pnpm ezlearn start\n\n命令：status | profile show/set | pack install/list/show/validate | goal create/list/show/update\nmaterial search | progress | review due/submit | plan next | lesson create/publish/show\nattempt start/draft/submit/pending/show | export | import | call OPERATION\n\n参数：--json --input FILE --output FILE --data-dir DIR --base-url URL\npack install DIR；pack install github.com/OWNER/REPO --ref TAG\nexport --output backup.json；import --input backup.json；import --validate --input backup.json\nprofile set --input profile.json（{kind:'remote',url:'https://…',token_env:'EZLEARN_API_TOKEN'}）\nstart 默认127.0.0.1:3210；--port NUMBER\n\n--json 时 stdout 仅返回 {ok,data/error}，诊断信息写 stderr。\n`;

async function main() {
  if (parseError) throw parseError;
  const [group, verb, arg] = positional;
  if (!group || flags.help || group === 'help') {
    if (flags.json) output({ help });
    else process.stdout.write(help);
    return;
  }
  if (group === 'profile') {
    if (verb === 'set') {
      const input = await inputFile();
      if (input.kind !== 'local' && input.kind !== 'remote')
        throw new AppError('INVALID_PROFILE', 'kind 必须为 local 或 remote');
      if (input.kind === 'remote') {
        if (typeof input.url !== 'string' || !/^https?:\/\//.test(input.url))
          throw new AppError('INVALID_PROFILE', '远端需要有效 HTTP(S) url');
        const url = new URL(input.url);
        if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
          throw new AppError('INVALID_PROFILE', '远端必须使用 HTTPS');
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
          throw new AppError(
            'INVALID_PROFILE',
            'url 只能是实例源地址，不能包含凭证、查询、片段或路径',
          );
        if (
          typeof input.token_env !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.token_env)
        )
          throw new AppError('INVALID_PROFILE', '请提供保存凭证的环境变量名 token_env');
      }
      const profile: Profile = {
        kind: input.kind,
        ...(input.kind === 'remote'
          ? { url: String(input.url).replace(/\/$/, ''), token_env: String(input.token_env) }
          : {}),
      };
      await mkdir(dataDir, { recursive: true });
      await writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf8');
      output(profile);
      return;
    }
    output(await readProfile());
    return;
  }
  const profile = await readProfile();
  const baseUrl = (
    stringFlag('base-url') ||
    process.env.EZLEARN_BASE_URL ||
    profile.url ||
    `http://127.0.0.1:${stringFlag('port') || 3210}`
  ).replace(/\/$/, '');
  const store =
    profile.kind === 'local' ? createLocalStore(resolve(dataDir, 'learning.sqlite')) : undefined;
  const service = store
    ? new LearningService(store, { baseUrl, backendId: profile.backend_id || baseUrl })
    : undefined;
  const execute = async (operation: Operation, input: Record<string, unknown>) => {
    if (service) return service.execute(operation, input);
    const token = process.env[profile.token_env || 'EZLEARN_API_TOKEN'];
    if (!token)
      throw new AppError(
        'MISSING_CREDENTIAL',
        `请设置环境变量 ${profile.token_env || 'EZLEARN_API_TOKEN'}`,
      );
    const response = await fetch(`${baseUrl}/api/rpc/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    });
    let result: {
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string; details?: unknown };
    };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new AppError('BACKEND_ERROR', `后端返回非JSON响应（${response.status}）`);
    }
    if (!result.ok)
      throw new AppError(
        result.error?.code || 'BACKEND_ERROR',
        result.error?.message || '后端调用失败',
        response.status,
        result.error?.details,
      );
    return result.data;
  };
  let keepOpen = false;
  try {
    if (group === 'start') {
      if (!service)
        throw new AppError(
          'REMOTE_PROFILE',
          '当前是远端 profile。请打开配置的URL；本地启动前切换到 local profile。',
        );
      const port = Number(stringFlag('port') || 3210);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new AppError('INVALID_ARGUMENT', '端口无效');
      const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/web');
      // Works from both src/cli (tsx) and dist/cli (compiled).
      const root = import.meta.url.includes('/dist/cli/')
        ? resolve(dirname(fileURLToPath(import.meta.url)), '../web')
        : webRoot;
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
      };
      const assets = async (request: Request) => {
        const url = new URL(request.url);
        let path: string;
        try {
          path = resolve(root, '.' + decodeURIComponent(url.pathname));
        } catch {
          return new Response('路径无效', { status: 400 });
        }
        const rel = relative(root, path);
        if (rel === '..' || rel.startsWith(`..${sep}`))
          return new Response('路径无效', { status: 403 });
        try {
          return new Response(await readFile(path), {
            headers: { 'Content-Type': mime[extname(path)] || 'application/octet-stream' },
          });
        } catch {
          try {
            return new Response(await readFile(resolve(root, 'index.html')), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          } catch {
            return new Response('请先运行 pnpm build，构建学习界面。', { status: 503 });
          }
        }
      };
      const app = createApp({ service, mode: 'local', baseUrl, assets });
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
        process.stderr.write(`ezlearn 正在 ${baseUrl} 运行；按 Ctrl+C 停止。数据：${dataDir}\n`);
        if (flags.json) output({ running: true, url: baseUrl, data_dir: dataDir });
      });
      keepOpen = true;
      const shutdown = () => {
        server.close(() => {
          void store?.close?.();
          process.exit(0);
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }
    let operation: Operation;
    let input = await inputFile();
    if (group === 'pack' && (verb === 'install' || verb === 'validate')) {
      const source = arg || stringFlag('source');
      if (!source) throw new AppError('INVALID_ARGUMENT', '请提供学习包目录或 GitHub URL');
      if (/^(https:\/\/)?github\.com\//.test(source)) {
        const ref = stringFlag('ref');
        if (!ref) throw new AppError('INVALID_ARGUMENT', 'GitHub 安装需要明确 --ref');
        input = await loadGithubPack(source, ref);
      } else
        input = {
          pack: await loadLocalPack(source),
          source: { kind: 'local', url: resolve(source) },
        };
      operation = verb === 'install' ? 'install_pack' : 'validate_pack';
      if (verb === 'validate') input = { pack: input.pack };
    } else {
      operation = (
        group === 'call' ? verb : mappings[`${group} ${verb}`] || mappings[group]
      ) as Operation;
      if (!operations.includes(operation))
        throw new AppError('UNKNOWN_COMMAND', '未知命令，请运行 ezlearn --help');
      if (group === 'import') {
        operation = flags.validate ? 'validate_import' : 'import_data';
        input = { bundle: input };
      }
      const idCommands = new Set([
        'get_pack',
        'get_goal',
        'get_lesson',
        'publish_lesson',
        'get_attempt',
      ]);
      if (idCommands.has(operation) && arg) input.id = arg;
      if (operation === 'get_pack' && stringFlag('version')) input.version = stringFlag('version');
      if (
        operation === 'get_progress' ||
        operation === 'get_due_reviews' ||
        operation === 'plan_next_session' ||
        operation === 'list_pending_attempts'
      ) {
        const goalId = stringFlag('goal') || arg || (group === 'progress' ? verb : undefined);
        if (goalId) input.goal_id = goalId;
      }
      if (operation === 'search_materials') {
        if (arg) input.query = positional.slice(2).join(' ');
        if (stringFlag('query')) input.query = stringFlag('query');
        if (stringFlag('pack')) input.pack_id = stringFlag('pack');
      }
    }
    if (operation === 'get_lesson' || operation === 'get_attempt') input.teacher = true;
    const data = await execute(operation, input);
    if (operation === 'export_data' && stringFlag('output')) {
      await writeFile(resolve(stringFlag('output')!), JSON.stringify(data, null, 2), 'utf8');
      output({ file: resolve(stringFlag('output')!), export: data });
    } else output(data);
  } finally {
    if (!keepOpen) await store?.close?.();
  }
}
main().catch((error) => {
  const result = errorResult(error);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!flags.json) process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = 1;
});
