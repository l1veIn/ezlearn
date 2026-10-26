import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalPlatform } from '../src/platform/local.js';

const cleanups: (() => void | Promise<void>)[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'ezlearn-lifecycle-')))
      throw new Error('无效测试清理路径');
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
async function directory() {
  const area = await mkdtemp(join(tmpdir(), 'ezlearn-lifecycle-'));
  directories.push(area);
  return area;
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无可用端口');
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}
async function start(dataDir: string, port: number) {
  const platform = await startLocalPlatform({ dataDir, port });
  cleanups.push(() => platform.close());
  return platform;
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGKILL');
  await stopped;
}
describe('本地平台实例生命周期', () => {
  it('同一数据目录不能同时绑定其他端口，失败时不覆盖凭证和连接文件', async () => {
    const dataDir = await directory();
    const first = await start(dataDir, await unusedPort());
    const connection = await readFile(join(dataDir, 'connection.json'), 'utf8');
    const credentials = await readFile(join(dataDir, 'credentials.json'), 'utf8');
    await expect(startLocalPlatform({ dataDir, port: await unusedPort() })).rejects.toMatchObject({
      code: 'INSTANCE_IN_USE',
    });
    expect(await readFile(join(dataDir, 'connection.json'), 'utf8')).toBe(connection);
    expect(await readFile(join(dataDir, 'credentials.json'), 'utf8')).toBe(credentials);
    expect((await fetch(`${first.status.endpoint}/health`)).ok).toBe(true);
  });
  it('正常关闭后可在新端口重启同一实例，重复close安全', async () => {
    const dataDir = await directory();
    const first = await start(dataDir, await unusedPort());
    await first.close();
    await first.close();
    const restarted = await start(dataDir, await unusedPort());
    expect(restarted.status.instance_id).toBe(first.status.instance_id);
    expect((await fetch(`${restarted.status.endpoint}/health`)).ok).toBe(true);
  });
  it('端口占用导致启动失败后释放目录锁，不写入实例凭证', async () => {
    const dataDir = await directory();
    const blocker = createServer();
    await new Promise<void>((done, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', done);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('无可用端口');
    cleanups.push(() => new Promise<void>((done) => blocker.close(() => done())));
    await expect(startLocalPlatform({ dataDir, port: address.port })).rejects.toMatchObject({
      code: 'PORT_IN_USE',
    });
    await expect(readFile(join(dataDir, 'credentials.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const restarted = await start(dataDir, await unusedPort());
    expect(restarted.status.running).toBe(true);
  });
  it('目录别名和Windows大小写变化仍对应同一实例锁', async () => {
    const area = await directory();
    const dataDir = join(area, 'InstanceData');
    const alias = join(area, 'alias');
    await mkdir(dataDir);
    await symlink(dataDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await start(dataDir, await unusedPort());
    await expect(
      startLocalPlatform({ dataDir: alias, port: await unusedPort() }),
    ).rejects.toMatchObject({ code: 'INSTANCE_IN_USE' });
    if (process.platform === 'win32')
      await expect(
        startLocalPlatform({ dataDir: dataDir.toUpperCase(), port: await unusedPort() }),
      ).rejects.toMatchObject({ code: 'INSTANCE_IN_USE' });
  });
  it.skipIf(!['win32', 'linux'].includes(process.platform))(
    '进程被强制终止后OS自动释放实例锁，可以恢复原数据目录',
    async () => {
      const dataDir = await directory();
      const port = await unusedPort();
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'tests/helpers/platform-lock-child.ts', dataDir, String(port)],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      cleanups.push(() => stopChild(child));
      await new Promise<void>((done, reject) => {
        let output = '';
        let errors = '';
        const timer = setTimeout(() => reject(new Error('子进程未及时就绪')), 10000);
        child.stderr!.on('data', (chunk) => {
          errors += String(chunk);
        });
        child.stdout!.on('data', (chunk) => {
          output += String(chunk);
          if (output.includes('PLATFORM_READY')) {
            clearTimeout(timer);
            done();
          }
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (!output.includes('PLATFORM_READY'))
            reject(new Error(`子进程提前退出：${code} ${errors}`));
        });
      });
      const connection = JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8'));
      await expect(startLocalPlatform({ dataDir, port: await unusedPort() })).rejects.toMatchObject(
        { code: 'INSTANCE_IN_USE' },
      );
      await stopChild(child);
      const restarted = await start(dataDir, port);
      expect(restarted.status.instance_id).toBe(connection.instance_id);
      expect((await fetch(`${restarted.status.endpoint}/health`)).ok).toBe(true);
    },
  );
});
