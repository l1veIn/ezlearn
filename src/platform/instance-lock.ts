import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError } from '../contracts/index.js';

/** An OS-held IPC listener owns a data directory for the lifetime of its platform. */
export async function acquireInstanceLock(directory: string) {
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(resolve(directory));
  const identity =
    process.platform === 'win32' ? canonicalDirectory.toLowerCase() : canonicalDirectory;
  const key = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  // Named pipes and Linux abstract sockets disappear when the owning process exits or crashes.
  // Other Unix platforms retain their normal socket path after a crash: never unlink an unknown lock.
  const address =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\ezlearn-instance-${key}`
      : process.platform === 'linux'
        ? String.fromCharCode(0) + `ezlearn-instance-${key}`
        : join(tmpdir(), `ezlearn-${key}.sock`);
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((done, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        done();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(address);
    });
  } catch (error) {
    server.close(() => {});
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new AppError(
        'INSTANCE_IN_USE',
        '这个数据目录已有平台实例运行，不能同时绑定另一个端点。请停止原实例，或为新实例指定其他数据目录。',
        409,
        !['win32', 'linux'].includes(process.platform)
          ? {
              lock_path: address,
              recovery: '此系统可能保留异常退出的 socket。请先确认没有活跃实例，再人工处理该路径。',
            }
          : undefined,
      );
    }
    throw new AppError(
      'INSTANCE_LOCK_UNAVAILABLE',
      '无法取得平台实例锁，请检查系统 IPC 权限；若系统保留了异常退出的 Unix socket，请先确认没有活跃实例再处理。',
      503,
    );
  }
  server.unref();
  let released: Promise<void> | undefined;
  return {
    directory: canonicalDirectory,
    release() {
      released ??= new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      return released;
    },
  };
}
