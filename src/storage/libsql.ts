import type { Client } from '@libsql/client';
import { emptyState, type State } from '../contracts/index.js';
import { migrationSQL, type SnapshotStore } from './types.js';
export async function initializeLibsql(client: Client) {
  await client.execute(migrationSQL);
  await client.execute({
    sql: 'INSERT OR IGNORE INTO ezlearn_state(id,revision,data,updated_at) VALUES(1,0,?,?)',
    args: [JSON.stringify(emptyState()), new Date().toISOString()],
  });
}
export function createLibsqlStore(client: Client): SnapshotStore {
  return {
    async read() {
      const r = await client.execute('SELECT revision,data FROM ezlearn_state WHERE id=1');
      const row = r.rows[0];
      if (!row) throw new Error('libSQL 未初始化，请执行数据库迁移');
      return { revision: Number(row.revision), state: JSON.parse(String(row.data)) as State };
    },
    async compareAndSwap(revision, state) {
      return (
        (
          await client.execute({
            sql: 'UPDATE ezlearn_state SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?',
            args: [JSON.stringify(state), new Date().toISOString(), revision],
          })
        ).rowsAffected === 1
      );
    },
    close() {
      client.close();
    },
  };
}
