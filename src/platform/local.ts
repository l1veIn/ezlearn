import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { API_VERSION, PLATFORM_VERSION, AppError } from '../contracts/index.js';
import { LearningService } from '../core/service.js';
import { createLocalStore } from '../storage/local.js';
import { createApp } from '../server/app.js';
import { acquireInstanceLock } from './instance-lock.js';

export interface LocalPlatformOptions {
  dataDir: string;
  port?: number;
  baseUrl?: string;
  apiToken?: string;
  sessionSecret?: string;
}
const credentialsSchema = z
  .object({
    schema_version: z.literal(1),
    instance_id: z.string().uuid(),
    api_token: z.string().min(24).max(300),
    session_secret: z.string().min(32).max(500),
  })
  .strict();
export async function startLocalPlatform(options: LocalPlatformOptions) {
  let dataDir = resolve(options.dataDir);
  const port = options.port ?? 3210;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new AppError('INVALID_ARGUMENT', '端口必须为 1～65535 的整数');
  const baseUrl = (options.baseUrl ?? `http://127.0.0.1:${port}`).replace(/\/$/, '');
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new AppError('INVALID_ENDPOINT', '本地平台需要有效 base URL');
  }
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    Number(base.port || 80) !== port ||
    base.pathname !== '/' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new AppError(
      'INVALID_ENDPOINT',
      '本地平台 base URL 必须与监听地址一致：http://127.0.0.1:<port>',
    );
  const instanceLock = await acquireInstanceLock(dataDir);
  dataDir = instanceLock.directory;
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/web');
    const webRoot = import.meta.url.includes('/dist/platform/')
      ? resolve(dirname(fileURLToPath(import.meta.url)), '../web')
      : root;
    let webReady = true;
    try {
      await stat(resolve(webRoot, 'index.html'));
    } catch {
      webReady = false;
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const credentialsPath = resolve(dataDir, 'credentials.json');
    let credentials: z.infer<typeof credentialsSchema>;
    try {
      credentials = credentialsSchema.parse(JSON.parse(await readFile(credentialsPath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new AppError('INVALID_CREDENTIAL', 'credentials.json 格式不正确，原文件已保留');
      credentials = {
        schema_version: 1,
        instance_id: crypto.randomUUID(),
        api_token: crypto.randomUUID() + crypto.randomUUID(),
        session_secret: crypto.randomUUID() + crypto.randomUUID(),
      };
    }
    credentials = credentialsSchema.parse({
      ...credentials,
      api_token: options.apiToken || process.env.EZLEARN_API_TOKEN || credentials.api_token,
      session_secret:
        options.sessionSecret || process.env.EZLEARN_SESSION_SECRET || credentials.session_secret,
    });
    const store = createLocalStore(resolve(dataDir, 'learning.sqlite'));
    const service = new LearningService(store, { baseUrl, backendId: credentials.instance_id });
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    const app = createApp({
      service,
      mode: 'local',
      baseUrl,
      apiToken: credentials.api_token,
      sessionSecret: credentials.session_secret,
      assets: async (request) => {
        let path: string;
        try {
          path = resolve(webRoot, '.' + decodeURIComponent(new URL(request.url).pathname));
        } catch {
          return new Response('路径无效', { status: 400 });
        }
        const rel = relative(webRoot, path);
        if (rel === '..' || rel.startsWith(`..${sep}`))
          return new Response('路径无效', { status: 403 });
        try {
          return new Response(await readFile(path), {
            headers: { 'Content-Type': mime[extname(path)] || 'application/octet-stream' },
          });
        } catch {
          try {
            return new Response(await readFile(resolve(webRoot, 'index.html')), {
              headers: { 'Content-Type': mime['.html'] },
            });
          } catch {
            return new Response('学习界面尚未构建，请先运行 pnpm build。', { status: 503 });
          }
        }
      },
    });
    let ready = false;
    const server = serve({
      fetch: (request) =>
        ready
          ? app.fetch(request)
          : Response.json(
              { ok: false, error: { code: 'STARTING', message: '平台正在初始化' } },
              { status: 503 },
            ),
      hostname: '127.0.0.1',
      port,
    });
    try {
      await new Promise<void>((done, reject) => {
        server.once('listening', done);
        server.once('error', reject);
      });
      await writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      });
      await writeFile(
        resolve(dataDir, 'connection.json'),
        JSON.stringify(
          {
            schema_version: 1,
            endpoint: base.origin,
            api_token: credentials.api_token,
            instance_id: credentials.instance_id,
            platform_version: PLATFORM_VERSION,
            api_version: API_VERSION,
          },
          null,
          2,
        ) + '\n',
        { encoding: 'utf8', mode: 0o600 },
      );
      ready = true;
    } catch (error) {
      await new Promise<void>((done) => server.close(() => done()));
      await store.close?.();
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
        throw new AppError(
          'PORT_IN_USE',
          `端口 ${port} 已被占用，请检查现有平台或指定其他端口`,
          409,
        );
      throw error;
    }
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        try {
          await new Promise<void>((done, reject) => {
            server.close((error) => {
              if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                reject(error);
                return;
              }
              done();
            });
            if ('closeIdleConnections' in server) server.closeIdleConnections();
          });
          await store.close?.();
        } finally {
          await instanceLock.release();
        }
      })());
    return {
      server,
      close,
      status: {
        running: true,
        version: PLATFORM_VERSION,
        api_version: API_VERSION,
        endpoint: base.origin,
        url: base.origin,
        data_dir: dataDir,
        instance_id: credentials.instance_id,
        web_ready: webReady,
      },
    };
  } catch (error) {
    await instanceLock.release();
    throw error;
  }
}
