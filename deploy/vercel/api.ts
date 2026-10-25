import { createClient } from '@libsql/client/web';
import { LearningService } from '../../src/core/service.js';
import { createLibsqlStore } from '../../src/storage/libsql.js';
import { createApp } from '../../src/server/app.js';

/** Web-standard Function handler; persistent state lives in libSQL, never /tmp. */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url || !/^libsql:\/\//.test(url))
      return Response.json(
        {
          ok: false,
          error: { code: 'CONFIGURATION_ERROR', message: '需要外部 libSQL/Turso 数据库 URL' },
        },
        { status: 503 },
      );
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    try {
      const baseUrl = process.env.EZLEARN_BASE_URL || '';
      const service = new LearningService(createLibsqlStore(client), {
        baseUrl,
        backendId: process.env.EZLEARN_BACKEND_ID || 'vercel',
      });
      const app = createApp({
        service,
        mode: 'remote',
        baseUrl,
        apiToken: process.env.EZLEARN_API_TOKEN,
        sessionSecret: process.env.EZLEARN_SESSION_SECRET,
      });
      return await app.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'request_failed',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      );
      return Response.json(
        {
          ok: false,
          error: { code: 'CONFIGURATION_ERROR', message: '实例配置或数据库迁移尚未完成' },
        },
        { status: 503 },
      );
    } finally {
      client.close();
    }
  },
};
