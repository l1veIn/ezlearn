import type { State } from '../contracts/index.js';
export interface Snapshot {
  revision: number;
  state: State;
}
/** One atomic CAS statement; no async callback transactions across runtimes. */
export interface SnapshotStore {
  read(): Promise<Snapshot>;
  compareAndSwap(revision: number, state: State): Promise<boolean>;
  close?(): void | Promise<void>;
}
export const MAX_STATE_BYTES = 1_500_000;
export const migrationSQL = `CREATE TABLE IF NOT EXISTS ezlearn_state (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL);`;
