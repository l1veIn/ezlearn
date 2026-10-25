import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyState, type State } from '../contracts/index.js';
import { migrationSQL, type SnapshotStore } from './types.js';
export function createLocalStore(path: string): SnapshotStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(migrationSQL);
  db.prepare(
    'INSERT OR IGNORE INTO ezlearn_state(id,revision,data,updated_at) VALUES(1,0,?,?)',
  ).run(JSON.stringify(emptyState()), new Date().toISOString());
  return {
    async read() {
      const row = db.prepare('SELECT revision,data FROM ezlearn_state WHERE id=1').get()!;
      return { revision: Number(row.revision), state: JSON.parse(String(row.data)) as State };
    },
    async compareAndSwap(revision, state) {
      return (
        db
          .prepare(
            'UPDATE ezlearn_state SET data=?, revision=revision+1, updated_at=? WHERE id=1 AND revision=?',
          )
          .run(JSON.stringify(state), new Date().toISOString(), revision).changes === 1
      );
    },
    close() {
      db.close();
    },
  };
}
