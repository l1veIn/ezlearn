/// <reference path="./worker-configuration.d.ts" />
/// <reference types="@cloudflare/workers-types" />
import { LearningService } from '../../src/core/service.js';
import { createD1Store } from '../../src/storage/d1.js';
import { createApp } from '../../src/server/app.js';

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    try {
      const service = new LearningService(createD1Store(env.DB), {
        baseUrl: env.EZLEARN_BASE_URL,
        backendId: env.EZLEARN_BACKEND_ID,
      });
      const app = createApp({
        service,
        mode: 'remote',
        baseUrl: env.EZLEARN_BASE_URL,
        apiToken: env.EZLEARN_API_TOKEN,
        sessionSecret: env.EZLEARN_SESSION_SECRET,
        assets: (r) => env.ASSETS.fetch(r),
      });
      return app.fetch(request);
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
    }
  },
};
