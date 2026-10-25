import { build } from 'esbuild';
import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.vercel/output');
if (dirname(out) !== resolve(root, '.vercel')) throw new Error('无效的构建输出路径');
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/functions/api.func`, { recursive: true });
await build({
  entryPoints: ['deploy/vercel/api.ts'],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'bundle',
  banner: {
    js: "import { createRequire } from 'node:module';const require=createRequire(import.meta.url);",
  },
});
await writeFile(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify(
    { runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: true },
    null,
    2,
  ),
);
await cp('dist/web', `${out}/static`, { recursive: true });
await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(api/.*|mcp|health)', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/.*', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel Build Output 已生成；未部署。');
