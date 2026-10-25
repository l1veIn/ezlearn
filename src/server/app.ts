import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  AppError,
  errorResult,
  learnerOperations,
  operations,
  type Operation,
} from '../contracts/index.js';
import type { LearningService } from '../core/service.js';
import { handleMcp } from '../mcp/index.js';

export interface AppOptions {
  service: LearningService;
  mode: 'local' | 'remote';
  baseUrl: string;
  apiToken?: string;
  sessionSecret?: string;
  assets?: (request: Request) => Promise<Response>;
}
const COOKIE = 'ezlearn_session';
const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
async function equalSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let n = 0;
  for (let i = 0; i < x.length; i++) n |= x[i] ^ y[i];
  return n === 0;
}
async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function validSession(cookie: string | undefined, secret: string): Promise<boolean> {
  const value = cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return false;
  const [expires, nonce, sig] = value.split('.');
  if (
    !expires ||
    !nonce ||
    !sig ||
    !/^\d+$/.test(expires) ||
    Number(expires) < Date.now() ||
    Number(expires) > Date.now() + 8 * 86400000
  )
    return false;
  return equalSecret(sig, await signature(`${expires}.${nonce}`, secret));
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json'))
    throw new AppError('CONTENT_TYPE', '请使用 application/json', 415);
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new AppError('PAYLOAD_TOO_LARGE', '请求不能超过 2MB', 413);
    }
    chunks.push(r.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AppError('INVALID_JSON', '请求需要 JSON 对象');
  }
}
function safePacks(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map((p) => ({
    id: p.id,
    version: p.version,
    checksum: p.checksum,
    source: p.source,
    installed_at: p.installed_at,
    pack: { manifest: p.pack.manifest, topics: p.pack.topics },
  }));
}
export function createApp(options: AppOptions) {
  const app = new Hono();
  const expectedOrigin = new URL(options.baseUrl).origin;
  if (
    options.mode === 'remote' &&
    (!options.apiToken ||
      options.apiToken.length < 24 ||
      !options.sessionSecret ||
      options.sessionSecret.length < 32)
  )
    throw new AppError(
      'AUTH_CONFIG',
      '远端需配置至少24字符 API token 和32字符 session secret',
      503,
    );
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const url = new URL(c.req.url);
    if (options.mode === 'local' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      throw new AppError('INVALID_HOST', '本地服务只接受回环 Host', 403);
    if (origin && origin !== expectedOrigin)
      throw new AppError('INVALID_ORIGIN', '请求来源与配置 base URL 不一致', 403);
    if (
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD' &&
      !origin &&
      c.req.header('sec-fetch-site') === 'cross-site'
    )
      throw new AppError('INVALID_ORIGIN', '拒绝跨站请求', 403);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (c.req.path.startsWith('/api') || c.req.path === '/mcp')
      c.header('Cache-Control', 'no-store');
    await next();
  });
  const isBearer = async (request: Request) =>
    options.mode === 'local' ||
    (await equalSecret(request.headers.get('authorization') || '', `Bearer ${options.apiToken}`));
  const isUser = async (request: Request) =>
    (await isBearer(request)) ||
    (await validSession(request.headers.get('cookie') || undefined, options.sessionSecret || ''));
  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));
  app.get('/api/auth', async (c) =>
    c.json({ ok: true, data: { mode: options.mode, authenticated: await isUser(c.req.raw) } }),
  );
  app.post('/api/login', async (c) => {
    const body = await readJson(c.req.raw);
    const token = body.token;
    if (
      typeof token !== 'string' ||
      token.length > 300 ||
      !(await equalSecret(token, options.apiToken || ''))
    )
      throw new AppError('UNAUTHORIZED', '凭证不正确', 401);
    const value = `${Date.now() + 7 * 86400000}.${crypto.randomUUID()}`;
    const sig = await signature(value, options.sessionSecret || 'local');
    c.header(
      'Set-Cookie',
      `${COOKIE}=${value}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(options.baseUrl).protocol === 'https:' ? '; Secure' : ''}`,
    );
    return c.json({ ok: true, data: { authenticated: true } });
  });
  app.post('/api/logout', (c) => {
    c.header('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return c.json({ ok: true, data: { authenticated: false } });
  });
  app.get('/api/dashboard', async (c) => {
    if (!(await isUser(c.req.raw))) throw new AppError('UNAUTHORIZED', '请先登录', 401);
    return c.json({ ok: true, data: await options.service.execute('dashboard', {}) });
  });
  app.post('/api/rpc/:operation', async (c) => {
    if (!(await isUser(c.req.raw)))
      throw new AppError('UNAUTHORIZED', '请先登录或提供 Agent 凭证', 401);
    const operation = c.req.param('operation') as Operation;
    if (!operations.includes(operation)) throw new AppError('UNKNOWN_OPERATION', '未知操作', 404);
    const bearer = await isBearer(c.req.raw);
    // Local CLI bypasses HTTP. Browser requests never become teacher requests without an explicit Bearer credential.
    const teacher = bearer && c.req.header('authorization')?.startsWith('Bearer ');
    if (!learnerOperations.has(operation) && !teacher)
      throw new AppError('FORBIDDEN', '此操作需由 Agent 使用管理凭证调用', 403);
    const input = await readJson(c.req.raw);
    if (operation === 'get_lesson' || operation === 'get_attempt') input.teacher = !!teacher;
    const data = await options.service.execute(operation, input);
    return c.json({
      ok: true,
      data: operation === 'list_packs' && !teacher ? safePacks(data) : data,
    });
  });
  app.all('/mcp', async (c) => {
    if (!(await isBearer(c.req.raw)))
      throw new AppError('UNAUTHORIZED', 'MCP 需要 Bearer 凭证', 401);
    return handleMcp(c.req.raw, options.service);
  });
  app.all('/api/*', (c) =>
    c.json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404),
  );
  app.get('*', async (c) =>
    options.assets
      ? options.assets(c.req.raw)
      : c.text('Web 尚未构建，请先运行 pnpm build，再运行 pnpm ezlearn start。', 503),
  );
  app.onError((error, c) => {
    const result = errorResult(error);
    if (result.error.code === 'INTERNAL_ERROR') console.error(error);
    return c.json(
      result,
      (error instanceof AppError
        ? error.status
        : result.error.code === 'VALIDATION_ERROR'
          ? 400
          : 500) as ContentfulStatusCode,
    );
  });
  return app;
}
