CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS functions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  caller_function_id INTEGER NOT NULL,
  callee_name TEXT NOT NULL,
  callee_file_hint TEXT,
  kind TEXT NOT NULL DEFAULT 'direct',
  FOREIGN KEY (caller_function_id) REFERENCES functions(id)
);

CREATE TABLE IF NOT EXISTS impacts (
  source_function_id INTEGER NOT NULL,
  target_function_id INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  FOREIGN KEY (source_function_id) REFERENCES functions(id),
  FOREIGN KEY (target_function_id) REFERENCES functions(id)
);
