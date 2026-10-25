import { createClient } from '@libsql/client';
import { initializeLibsql } from '../../src/storage/libsql.js';
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('请设置 TURSO_DATABASE_URL 与 TURSO_AUTH_TOKEN');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
try {
  await initializeLibsql(client);
  console.log('libSQL schema 已初始化（幂等）');
} finally {
  client.close();
}
