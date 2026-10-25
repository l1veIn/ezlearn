import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { AppError, packSchema, type Pack } from '../contracts/index.js';

export async function loadLocalPack(directory: string): Promise<Pack> {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new AppError('INVALID_PATH', '包源必须是普通目录，不能是符号链接');
  const canonicalRoot = await realpath(root);
  let total = 0,
    entries = 0;
  async function inspect(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new AppError('INVALID_PATH', '包目录不能含符号链接');
    const rel = relative(canonicalRoot, await realpath(path));
    if (rel === '..' || rel.startsWith(`..${sep}`))
      throw new AppError('INVALID_PATH', '包路径越界');
    if (++entries > 300) throw new AppError('PACK_TOO_LARGE', '包目录文件数量超限');
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await inspect(resolve(path, entry));
    } else if (stat.isFile()) {
      total += stat.size;
      if (stat.size > 400_000 || total > 1_000_000)
        throw new AppError('PACK_TOO_LARGE', '包文件最大 400KB，目录总计最大 1MB');
    } else throw new AppError('INVALID_PATH', '学习包仅支持普通数据文件');
  }
  await inspect(canonicalRoot);
  let data: unknown;
  try {
    data = JSON.parse(await readFile(resolve(root, 'pack.json'), 'utf8'));
  } catch {
    throw new AppError('INVALID_JSON', '目录中需要有效的 pack.json');
  }
  return packSchema.parse(data);
}
