import { type State } from '../contracts/index.js';
import type { SnapshotStore } from './types.js';
// Structural subset of generated D1 binding types; no Node APIs in edge adapters.
interface Binding {
  prepare(sql: string): {
    bind(...args: (string | number)[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
    first<T>(): Promise<T | null>;
  };
}
export function createD1Store(db: Binding): SnapshotStore {
  return {
    async read() {
      const row = await db
        .prepare('SELECT revision,data FROM ezlearn_state WHERE id=1')
        .first<{ revision: number; data: string }>();
      if (!row) throw new Error('D1 未初始化，请执行数据库迁移');
      return { revision: row.revision, state: JSON.parse(row.data) as State };
    },
    async compareAndSwap(revision, state) {
      const r = await db
        .prepare(
          'UPDATE ezlearn_state SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?',
        )
        .bind(JSON.stringify(state), new Date().toISOString(), revision)
        .run();
      return r.meta.changes === 1;
    },
  };
}
