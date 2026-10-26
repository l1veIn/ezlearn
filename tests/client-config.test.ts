import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveToken } from '../src/cli/config.js';
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('凭证只来自端点匹配的实例文件或显式环境变量引用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezlearn-client-config-'));
  dirs.push(dir);
  const token = crypto.randomUUID();
  vi.stubEnv('EZLEARN_API_TOKEN', token);
  const target = { endpoint: 'http://127.0.0.1:3210' };
  expect(await resolveToken(target, dir)).toBeUndefined();
  writeFileSync(
    join(dir, 'connection.json'),
    JSON.stringify({ endpoint: 'http://127.0.0.1:3211', api_token: token }),
  );
  expect(await resolveToken(target, dir)).toBeUndefined();
  await expect(
    resolveToken({ ...target, connection_file: join(dir, 'connection.json') }, dir),
  ).rejects.toMatchObject({ code: 'ENDPOINT_MISMATCH' });
  expect(await resolveToken({ ...target, token_env: 'EZLEARN_API_TOKEN' }, dir)).toBe(token);
  writeFileSync(
    join(dir, 'connection.json'),
    JSON.stringify({ endpoint: target.endpoint, api_token: token }),
  );
  expect(await resolveToken(target, dir)).toBe(token);
});
