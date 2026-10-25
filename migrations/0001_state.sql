-- v0.1: bounded single-user aggregate. Primary key is the CAS lookup index.
CREATE TABLE IF NOT EXISTS ezlearn_state (
 id INTEGER PRIMARY KEY CHECK (id=1),
 revision INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL CHECK(json_valid(data)),
 updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO ezlearn_state(id, revision, data, updated_at)
VALUES(1,0,'{"schema_version":1,"packs":{},"goals":{},"lessons":{},"attempts":{},"reviews":{},"progress":{},"evidence":{}}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
