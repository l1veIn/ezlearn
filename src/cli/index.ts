#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AppError,
  errorResult,
  operations,
  PLATFORM_VERSION,
  API_VERSION,
  type Operation,
} from '../contracts/index.js';
import { loadLocalPack } from './pack-loader.js';
import { PlatformClient } from './client.js';
import {
  loadConfig,
  saveConfig,
  parseProfile,
  resolveToken,
  normalizeEndpoint,
  validateProfileName,
  type Profile,
} from './config.js';

const booleans = new Set(['json', 'validate', 'help', 'version']);
const positional: string[] = [];
const flags: Record<string, string | boolean> = {};
let parseError: AppError | undefined;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) {
    positional.push(arg);
    continue;
  }
  const eq = arg.indexOf('=');
  const key = arg.slice(2, eq < 0 ? undefined : eq);
  if (booleans.has(key)) flags[key] = true;
  else if (eq >= 0) flags[key] = arg.slice(eq + 1);
  else {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) {
      parseError = new AppError('INVALID_ARGUMENT', `--${key} 需要值`);
      break;
    }
    flags[key] = value;
  }
}
const stringFlag = (name: string) =>
  typeof flags[name] === 'string' ? (flags[name] as string) : undefined;
const dataDir = resolve(stringFlag('data-dir') || process.env.EZLEARN_DATA_DIR || '.ezlearn');
const configDir = resolve(stringFlag('config-dir') || process.env.EZLEARN_CONFIG_DIR || dataDir);
function output(data: unknown) {
  process.stdout.write(JSON.stringify({ ok: true, data }, null, flags.json ? undefined : 2) + '\n');
}
async function inputFile(): Promise<Record<string, unknown>> {
  const path = stringFlag('input');
  if (!path) return {};
  let value: string;
  if (path === '-') {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 2_000_000) throw new AppError('PAYLOAD_TOO_LARGE', '输入不能超过 2MB');
      chunks.push(data);
    }
    value = Buffer.concat(chunks).toString('utf8');
  } else {
    const file = resolve(path);
    if ((await stat(file)).size > 2_000_000)
      throw new AppError('PAYLOAD_TOO_LARGE', '输入不能超过 2MB');
    value = await readFile(file, 'utf8');
  }
  if (Buffer.byteLength(value) > 2_000_000)
    throw new AppError('PAYLOAD_TOO_LARGE', '输入不能超过 2MB');
  try {
    const result = JSON.parse(value);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new AppError('INVALID_JSON', '输入文件需要有效 JSON 对象');
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
const help = `ezlearn ${PLATFORM_VERSION} — 学习平台的实例管理与终端入口\n\n平台独立启动：pnpm platform:start\n本地管理：platform start | platform doctor（start 为 platform start 的别名）\n端点管理：profile show/list/set/use\n学习操作：status | pack install/list/show/validate | goal create/list/show/update\nmaterial search | progress | review due/submit | plan next | lesson create/publish/show\nattempt start/draft/submit/pending/show | export | import | call OPERATION\n\nprofile set --name cloud --input profile.json（{\"endpoint\":\"https://…\",\"token_env\":\"EZLEARN_API_TOKEN\"}）\nprofile use cloud；--profile NAME 为单次覆盖；--endpoint URL 为单次端点覆盖\n--config-dir DIR 独立配置目录，--data-dir DIR 指定本机平台与实例连接文件目录\n--json --input FILE（或 - 读取stdin）--output FILE\npack install DIR；pack install github.com/OWNER/REPO --ref TAG（由平台下载）\nexport --output backup.json；import --validate --input backup.json\n\n全部学习操作经 HTTP，平台未运行时提示启动，不直连数据库。\n平台安装器、下载发布制品与自动升级尚未交付，当前从源码构建。\n`;

async function runPlatform() {
  const platform = await import('../platform/local.js');
  const port = Number(stringFlag('port') || 3210);
  const instance = await platform.startLocalPlatform({
    dataDir,
    port,
    baseUrl: stringFlag('base-url') || process.env.EZLEARN_BASE_URL || `http://127.0.0.1:${port}`,
  });
  process.stderr.write(
    `ezlearn 平台 ${PLATFORM_VERSION} 正在 ${instance.status.endpoint} 运行；按 Ctrl+C 停止。\n`,
  );
  if (flags.json) output(instance.status);
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void instance.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
async function main() {
  if (parseError) throw parseError;
  if (flags.version) {
    if (flags.json) output({ client_version: PLATFORM_VERSION, api_version: API_VERSION });
    else process.stdout.write(`ezlearn CLI ${PLATFORM_VERSION} / API v${API_VERSION}\n`);
    return;
  }
  const [group, verb, arg] = positional;
  if (!group || flags.help || group === 'help') {
    const content =
      help +
      '\n跨端点 --endpoint 覆盖会清除原 profile 凭证引用；用 --token-env ENV 或 --connection-file FILE 显式指定新引用。\n';
    if (flags.json) output({ help: content });
    else process.stdout.write(content);
    return;
  }
  if (group === 'start' || (group === 'platform' && verb === 'start')) {
    await runPlatform();
    return;
  }
  const config = await loadConfig(configDir);
  if (group === 'profile') {
    if (verb === 'set') {
      const name = validateProfileName(stringFlag('name') || config.current);
      const input = await inputFile();
      const profile = parseProfile(input);
      if (profile.connection_file) profile.connection_file = resolve(profile.connection_file);
      config.profiles[name] = profile;
      await saveConfig(configDir, config);
      output({ name, profile, current: config.current });
      return;
    }
    if (verb === 'use') {
      if (!arg || !Object.hasOwn(config.profiles, arg))
        throw new AppError('PROFILE_NOT_FOUND', '请提供已配置的 profile 名称');
      config.current = arg;
      await saveConfig(configDir, config);
      output({ name: arg, ...config.profiles[arg] });
      return;
    }
    if (verb === 'list') {
      output(
        Object.entries(config.profiles).map(([name, profile]) => ({
          name,
          current: config.current === name,
          ...profile,
        })),
      );
      return;
    }
    if (verb && verb !== 'show')
      throw new AppError('UNKNOWN_COMMAND', 'profile 支持 show、list、set、use');
    const name = stringFlag('profile') || config.current;
    if (!Object.hasOwn(config.profiles, name))
      throw new AppError('PROFILE_NOT_FOUND', `未配置 profile：${name}`);
    output({ name, ...config.profiles[name] });
    return;
  }
  const name = stringFlag('profile') || config.current;
  if (!Object.hasOwn(config.profiles, name))
    throw new AppError('PROFILE_NOT_FOUND', `未配置 profile：${name}`);
  const configured = config.profiles[name];
  const endpointOverride =
    stringFlag('endpoint') ||
    stringFlag('base-url') ||
    (!stringFlag('profile')
      ? process.env.EZLEARN_ENDPOINT || process.env.EZLEARN_BASE_URL
      : undefined);
  const endpoint = normalizeEndpoint(endpointOverride || configured.endpoint);
  // Credentials belong to a configured endpoint. An override never carries another profile's keys.
  const profile: Profile = parseProfile({
    ...(endpoint === configured.endpoint ? configured : {}),
    endpoint,
    ...(stringFlag('token-env') ? { token_env: stringFlag('token-env') } : {}),
    ...(stringFlag('connection-file')
      ? { connection_file: resolve(stringFlag('connection-file')!) }
      : {}),
  });
  const client = new PlatformClient(profile.endpoint, await resolveToken(profile, dataDir));
  if (group === 'platform') {
    if (verb !== 'doctor')
      throw new AppError(
        'UNKNOWN_COMMAND',
        'platform 支持 start 和 doctor；发布制品安装/自动升级尚未交付',
      );
    const health = await client.health();
    const platform = await client.metadata();
    if (!platform.teacher_authenticated)
      throw new AppError(
        'MISSING_CREDENTIAL',
        '平台可访问，但 CLI 缺少教师凭证。请指定对应实例的 --data-dir / connection_file，或配置 token_env。',
        401,
        { endpoint: profile.endpoint },
      );
    output({
      healthy: true,
      client_version: PLATFORM_VERSION,
      node_version: process.versions.node,
      profile: name,
      endpoint: profile.endpoint,
      platform,
      checks: { http: true, api_compatible: true, authentication: true },
      health,
    });
    return;
  }
  let operation: Operation;
  let input = await inputFile();
  if (group === 'pack' && (verb === 'install' || verb === 'validate')) {
    const source = arg || stringFlag('source');
    if (!source) throw new AppError('INVALID_ARGUMENT', '请提供包目录或 GitHub 仓库地址');
    if (/^(https:\/\/)?github\.com\//.test(source)) {
      const ref = stringFlag('ref');
      if (!ref) throw new AppError('INVALID_ARGUMENT', 'GitHub 学习包必须指定 --ref');
      output(await client.installGithub(source, ref, verb === 'validate'));
      return;
    }
    const pack = await loadLocalPack(source);
    input =
      verb === 'validate' ? { pack } : { pack, source: { kind: 'local', url: resolve(source) } };
    operation = verb === 'validate' ? 'validate_pack' : 'install_pack';
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
    if (
      new Set(['get_pack', 'get_goal', 'get_lesson', 'publish_lesson', 'get_attempt']).has(
        operation,
      ) &&
      arg
    )
      input.id = arg;
    if (operation === 'get_pack' && stringFlag('version')) input.version = stringFlag('version');
    if (
      ['get_progress', 'get_due_reviews', 'plan_next_session', 'list_pending_attempts'].includes(
        operation,
      )
    ) {
      const id = stringFlag('goal') || arg || (group === 'progress' ? verb : undefined);
      if (id) input.goal_id = id;
    }
    if (operation === 'search_materials') {
      if (arg) input.query = positional.slice(2).join(' ');
      if (stringFlag('query')) input.query = stringFlag('query');
      if (stringFlag('pack')) input.pack_id = stringFlag('pack');
    }
  }
  if (operation === 'get_lesson' || operation === 'get_attempt') input.teacher = true;
  const result = await client.call(operation, input);
  if (operation === 'export_data' && stringFlag('output')) {
    await writeFile(resolve(stringFlag('output')!), JSON.stringify(result, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    output({
      file: resolve(stringFlag('output')!),
      source_revision: result.source_revision,
      checksum: result.checksum,
    });
  } else output(result);
}
main().catch((error) => {
  const result = errorResult(error);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!flags.json) process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = 1;
});
