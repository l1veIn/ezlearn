#!/usr/bin/env node
import { resolve } from 'node:path';
import { errorResult, AppError } from '../contracts/index.js';
import { startLocalPlatform } from './local.js';

async function main() {
  const flags: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const name = process.argv[i];
    if (name === '--json') {
      flags.json = true;
      continue;
    }
    if (
      !['--data-dir', '--port', '--base-url'].includes(name) ||
      !process.argv[i + 1] ||
      process.argv[i + 1].startsWith('--')
    )
      throw new AppError(
        'INVALID_ARGUMENT',
        '平台入口支持 --data-dir DIR --port NUMBER --base-url URL --json',
      );
    flags[name.slice(2)] = process.argv[++i];
  }
  const platform = await startLocalPlatform({
    dataDir: resolve(String(flags['data-dir'] || process.env.EZLEARN_DATA_DIR || '.ezlearn')),
    port: Number(flags.port || process.env.PORT || 3210),
    baseUrl: String(
      flags['base-url'] ||
        process.env.EZLEARN_BASE_URL ||
        `http://127.0.0.1:${flags.port || process.env.PORT || 3210}`,
    ),
  });
  process.stderr.write(
    `ezlearn 平台 ${platform.status.version} 正在 ${platform.status.endpoint} 运行；按 Ctrl+C 停止。\n`,
  );
  if (flags.json) process.stdout.write(JSON.stringify({ ok: true, data: platform.status }) + '\n');
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void platform.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((error) => {
  const result = errorResult(error);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = 1;
});
