import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../contracts/index.js';

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3210';
export function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('INVALID_ENDPOINT', 'endpoint 需要有效的 HTTP(S) 实例地址');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new AppError('INVALID_ENDPOINT', 'endpoint 只能包含协议、主机和端口，不能包含凭证或路径');
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new AppError('INVALID_ENDPOINT', '非回环端点必须使用 HTTPS');
  return url.origin;
}
const profileSchema = z
  .object({
    endpoint: z.string().transform(normalizeEndpoint),
    token_env: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
    connection_file: z.string().min(1).optional(),
  })
  .strict();
const nameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
  .refine((s) => !['constructor', 'prototype', '__proto__'].includes(s));
export type Profile = z.infer<typeof profileSchema>;
const configSchema = z
  .object({
    schema_version: z.literal(1),
    current: nameSchema,
    profiles: z.record(nameSchema, profileSchema),
  })
  .strict();
export type ClientConfig = z.infer<typeof configSchema>;
export async function saveConfig(directory: string, config: ClientConfig) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, 'profiles.json');
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}
export async function loadConfig(directory: string): Promise<ClientConfig> {
  try {
    const config = configSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'profiles.json'), 'utf8')),
    );
    if (!Object.hasOwn(config.profiles, config.current)) throw new Error('missing current profile');
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AppError('INVALID_PROFILE', 'profiles.json 格式错误，请检查配置；不会覆盖原文件');
  }
  try {
    const legacy = JSON.parse(await readFile(resolve(directory, 'profile.json'), 'utf8'));
    if (legacy.kind !== 'local' && legacy.kind !== 'remote')
      throw new Error('unsupported legacy profile');
    if (legacy.kind === 'remote' && (typeof legacy.url !== 'string' || !legacy.url.trim()))
      throw new Error('remote endpoint missing');
    const migrated: ClientConfig = {
      schema_version: 1,
      current: 'default',
      profiles: {
        default: profileSchema.parse({
          endpoint: legacy.kind === 'remote' ? legacy.url : DEFAULT_ENDPOINT,
          ...(legacy.kind === 'remote'
            ? { token_env: legacy.token_env || 'EZLEARN_API_TOKEN' }
            : {}),
        }),
      },
    };
    await saveConfig(directory, migrated);
    return migrated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AppError('INVALID_PROFILE', '旧 profile.json 无法迁移，原文件已保留');
  }
  return {
    schema_version: 1,
    current: 'default',
    profiles: { default: { endpoint: DEFAULT_ENDPOINT } },
  };
}
export function parseProfile(input: unknown): Profile {
  const legacy = input as { kind?: unknown; url?: unknown; token_env?: unknown };
  if (legacy?.kind === 'local') return profileSchema.parse({ endpoint: DEFAULT_ENDPOINT });
  if (legacy?.kind === 'remote')
    return profileSchema.parse({
      endpoint: legacy.url,
      token_env: legacy.token_env || 'EZLEARN_API_TOKEN',
    });
  return profileSchema.parse(input);
}
export function validateProfileName(name: string) {
  return nameSchema.parse(name);
}
export async function resolveToken(
  profile: Profile,
  dataDirectory: string,
): Promise<string | undefined> {
  if (profile.token_env) {
    const value = process.env[profile.token_env];
    if (!value) throw new AppError('MISSING_CREDENTIAL', `请设置环境变量 ${profile.token_env}`);
    return value;
  }
  const path = profile.connection_file
    ? resolve(profile.connection_file)
    : resolve(dataDirectory, 'connection.json');
  try {
    const local = JSON.parse(await readFile(path, 'utf8'));
    if (normalizeEndpoint(local.endpoint) !== profile.endpoint) {
      if (profile.connection_file)
        throw new AppError('ENDPOINT_MISMATCH', 'connection_file 属于另一个平台端点');
    } else if (typeof local.api_token === 'string' && local.api_token.length >= 24)
      return local.api_token;
    else throw new AppError('INVALID_CREDENTIAL', '实例连接文件缺少有效凭证，请重新启动该实例');
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AppError('INVALID_CREDENTIAL', '实例连接文件格式错误，请重新启动该实例');
    if (profile.connection_file)
      throw new AppError('MISSING_CREDENTIAL', '配置的 connection_file 不存在，请先启动对应平台');
  }
  return undefined;
}
