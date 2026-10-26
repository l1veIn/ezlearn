import {
  AppError,
  PLATFORM_VERSION,
  packSchema,
  type Pack,
  type PackSource,
} from '../contracts/index.js';

const MAX_FILE_BYTES = 400_000;
export async function boundedJson(response: Response, max = MAX_FILE_BYTES): Promise<unknown> {
  if (!response.ok)
    throw new AppError('FETCH_FAILED', `读取公开仓库失败（HTTP ${response.status}）`, 400);
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('FETCH_FAILED', '远端响应为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new AppError('PACK_TOO_LARGE', '学习包超出单文件大小限制');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError('INVALID_JSON', '文件不是有效 JSON');
  }
}

/** Fetch only a root data file at an immutable commit; never extract or execute an archive. */
export async function loadGithubPack(
  repo: string,
  ref: string,
): Promise<{ pack: Pack; source: PackSource }> {
  const match =
    /^(?:https:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(repo);
  if (!match || !ref || ref.length > 200)
    throw new AppError(
      'INVALID_SOURCE',
      '请提供公开 github.com/owner/repo 地址和明确的 --ref tag/commit',
    );
  const owner = match[1],
    name = match[2];
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `ezlearn/${PLATFORM_VERSION}`,
  };
  const commit = (await boundedJson(
    await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`,
      { headers, signal: AbortSignal.timeout(20000) },
    ),
    200_000,
  )) as { sha?: unknown };
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha))
    throw new AppError('INVALID_SOURCE', 'GitHub 未返回可验证的提交版本');
  const data = await boundedJson(
    await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${commit.sha}/pack.json`, {
      signal: AbortSignal.timeout(20000),
    }),
  );
  return {
    pack: packSchema.parse(data),
    source: {
      kind: 'github',
      url: `https://github.com/${owner}/${name}`,
      ref,
      resolved: commit.sha,
    },
  };
}
