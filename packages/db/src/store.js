import { DatabaseSync } from "node:sqlite";
import { promises as fs } from "node:fs";
import path from "node:path";

const STATE_DIR_NAME = ".symapse";
const DB_FILE_NAME = "state.db";

function getStateDir(repoRoot) {
  return path.join(repoRoot, STATE_DIR_NAME);
}

function getDbPath(repoRoot) {
  return path.join(getStateDir(repoRoot), DB_FILE_NAME);
}

function openDatabase(repoRoot) {
  return new DatabaseSync(getDbPath(repoRoot));
}

function ensureSchema(db) {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      qualifiedName TEXT NOT NULL,
      kind TEXT NOT NULL,
      filePath TEXT NOT NULL,
      startLine INTEGER,
      endLine INTEGER,
      exported INTEGER DEFAULT 0,
      isDefault INTEGER DEFAULT 0,
      parentName TEXT,
      bodyHash TEXT
    );
    CREATE TABLE IF NOT EXISTS relations (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      targetId TEXT NOT NULL,
      sourceFilePath TEXT,
      targetFilePath TEXT,
      sourceKind TEXT,
      targetKind TEXT,
      sourceName TEXT,
      targetName TEXT,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS summary (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(targetId);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(sourceId);
    CREATE INDEX IF NOT EXISTS idx_relations_kind ON relations(kind);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(filePath);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
  `);
}

async function ensureStateDir(repoRoot) {
  await fs.mkdir(getStateDir(repoRoot), { recursive: true });
}

export function getRuntimePath(repoRoot) {
  return path.join(getStateDir(repoRoot), "runtime.json");
}

export async function writeRuntimeInfo(repoRoot, runtimeInfo) {
  await ensureStateDir(repoRoot);
  await fs.writeFile(getRuntimePath(repoRoot), JSON.stringify(runtimeInfo, null, 2), "utf8");
}

export async function readRuntimeInfo(repoRoot) {
  try {
    const raw = await fs.readFile(getRuntimePath(repoRoot), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readIndexState(repoRoot) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);

  try {
    ensureSchema(db);

    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM symbols").get();
    if (!countRow || countRow.cnt === 0) {
      return null;
    }

    const symbols = db.prepare("SELECT * FROM symbols ORDER BY rowid").all().map((row) => ({
      id: row.id,
      name: row.name,
      qualifiedName: row.qualifiedName,
      kind: row.kind,
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      exported: Boolean(row.exported),
      isDefault: Boolean(row.isDefault),
      parentName: row.parentName || null,
      key: `${row.kind}:${row.filePath}:${row.qualifiedName}:${row.parentName || ""}`,
      body: "",
      bodyHash: row.bodyHash || ""
    }));

    const relations = db.prepare("SELECT * FROM relations ORDER BY rowid").all().map((row) => ({
      kind: row.kind,
      sourceId: row.sourceId,
      targetId: row.targetId,
      sourceFilePath: row.sourceFilePath,
      targetFilePath: row.targetFilePath,
      sourceKind: row.sourceKind,
      targetKind: row.targetKind,
      sourceName: row.sourceName,
      targetName: row.targetName,
      label: row.label
    }));

    const summaryRows = db.prepare("SELECT key, value FROM summary").all();
    const summary = {};
    for (const row of summaryRows) {
      try {
        summary[row.key] = JSON.parse(row.value);
      } catch {
        summary[row.key] = row.value;
      }
    }

    const changedFunctions = summary._changedFunctions || [];
    const removedFunctions = summary._removedFunctions || [];
    const files = summary._files || [];

    return {
      indexedAt: summary._indexedAt || "",
      repoRoot: summary._repoRoot || repoRoot,
      storageRoot: summary._storageRoot || repoRoot,
      engineVersion: Number(summary._engineVersion) || 1,
      symbols,
      functions: symbols,
      relations,
      edges: relations,
      summary: {
        fileCount: summary._fileCount || 0,
        functionCount: summary._functionCount || 0,
        classCount: summary._classCount || 0,
        methodCount: summary._methodCount || 0,
        moduleCount: summary._moduleCount || 0,
        symbolCount: symbols.length,
        edgeCount: relations.length,
        changedCount: changedFunctions.length,
        removedCount: removedFunctions.length,
        initialIndex: false
      },
      changedFunctions,
      removedFunctions,
      files
    };
  } finally {
    db.close();
  }
}

export async function writeIndexState(repoRoot, state) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);

  try {
    ensureSchema(db);

    db.exec("DELETE FROM symbols");
    db.exec("DELETE FROM relations");
    db.exec("DELETE FROM summary");

    const insertSymbol = db.prepare(`
      INSERT OR IGNORE INTO symbols (id, name, qualifiedName, kind, filePath, startLine, endLine, exported, isDefault, parentName, bodyHash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");
    for (const sym of (state.symbols || state.functions || [])) {
      insertSymbol.run(
        sym.id,
        sym.name,
        sym.qualifiedName,
        sym.kind,
        sym.filePath,
        sym.startLine,
        sym.endLine,
        sym.exported ? 1 : 0,
        sym.isDefault ? 1 : 0,
        sym.parentName || null,
        sym.bodyHash || ""
      );
    }
    db.exec("COMMIT");

    const insertRelation = db.prepare(`
      INSERT INTO relations (kind, sourceId, targetId, sourceFilePath, targetFilePath, sourceKind, targetKind, sourceName, targetName, label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");
    for (const rel of (state.relations || state.edges || [])) {
      insertRelation.run(
        rel.kind,
        rel.sourceId,
        rel.targetId,
        rel.sourceFilePath || "",
        rel.targetFilePath || "",
        rel.sourceKind || "",
        rel.targetKind || "",
        rel.sourceName || "",
        rel.targetName || "",
        rel.label || ""
      );
    }
    db.exec("COMMIT");

    const insertSummary = db.prepare(`
      INSERT INTO summary (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    const sum = state.summary || {};
    insertSummary.run("_indexedAt", state.indexedAt || "");
    insertSummary.run("_repoRoot", state.repoRoot || "");
    insertSummary.run("_storageRoot", state.storageRoot || "");
    insertSummary.run("_fileCount", String(sum.fileCount || 0));
    insertSummary.run("_functionCount", String(sum.functionCount || 0));
    insertSummary.run("_classCount", String(sum.classCount || 0));
    insertSummary.run("_methodCount", String(sum.methodCount || 0));
    insertSummary.run("_moduleCount", String(sum.moduleCount || 0));
    insertSummary.run("_changedFunctions", JSON.stringify(state.changedFunctions || []));
    insertSummary.run("_removedFunctions", JSON.stringify(state.removedFunctions || []));
    insertSummary.run("_engineVersion", String(state.engineVersion || 1));
    insertSummary.run("_files", JSON.stringify((state.files || []).map((f) => ({ path: f.path, hash: f.hash, mtimeMs: f.mtimeMs || 0, size: f.size || 0 }))));
  } finally {
    db.close();
  }
}

export function ensureSessionSchema(repoRoot) {
  const db = openDatabase(repoRoot);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS session_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      symbol_or_file TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_signals_session ON session_signals(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_signals_action ON session_signals(action_type)");
  } finally {
    db.close();
  }
}

export async function writeSessionSignal(repoRoot, sessionId, actionType, symbolOrFile) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS session_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      symbol_or_file TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare("INSERT INTO session_signals (session_id, action_type, symbol_or_file) VALUES (?, ?, ?)").run(sessionId, actionType, symbolOrFile);
  } finally {
    db.close();
  }
}

export async function querySessionSignals(repoRoot) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS session_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, action_type TEXT NOT NULL, symbol_or_file TEXT NOT NULL, timestamp TEXT DEFAULT (datetime('now')))");
    return db.prepare("SELECT * FROM session_signals ORDER BY timestamp ASC").all();
  } finally {
    db.close();
  }
}

export async function storeKnowledge(repoRoot, type, key, value, sessionId) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS codebase_knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, session_id TEXT, confidence REAL DEFAULT 1.0, timestamp TEXT DEFAULT (datetime('now')))");
    try { db.exec("ALTER TABLE codebase_knowledge ADD COLUMN confidence REAL DEFAULT 1.0"); } catch {}
    db.prepare("INSERT INTO codebase_knowledge (type, key, value, session_id, confidence) VALUES (?, ?, ?, ?, 1.0)").run(type, key, value, sessionId || "");
  } finally { db.close(); }
}

export async function queryKnowledge(repoRoot, type) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS codebase_knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, session_id TEXT, confidence REAL DEFAULT 1.0, timestamp TEXT DEFAULT (datetime('now')))");
    const rows = type
      ? db.prepare("SELECT * FROM codebase_knowledge WHERE type = ? AND confidence >= 0.4 ORDER BY timestamp DESC LIMIT 20").all(type)
      : db.prepare("SELECT * FROM codebase_knowledge WHERE confidence >= 0.4 ORDER BY timestamp DESC LIMIT 50").all();
    return rows;
  } finally { db.close(); }
}

export async function validateKnowledge(repoRoot, activeSymbols, activeFiles) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS codebase_knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, session_id TEXT, confidence REAL DEFAULT 1.0, timestamp TEXT DEFAULT (datetime('now')))");
    try { db.exec("ALTER TABLE codebase_knowledge ADD COLUMN confidence REAL DEFAULT 1.0"); } catch {}
    const all = db.prepare("SELECT id, key, type, confidence FROM codebase_knowledge WHERE confidence >= 0.15").all();
    const degrade = db.prepare("UPDATE codebase_knowledge SET confidence = ? WHERE id = ?");
    const purge = db.prepare("DELETE FROM codebase_knowledge WHERE id = ?");
    const symSet = new Set(activeSymbols || []);
    const fileSet = new Set(activeFiles || []);

    for (const entry of all) {
      const parts = entry.key.split(" → ");
      let exists = false;
      for (const part of parts) {
        const trimmed = part.trim();
        if (symSet.has(trimmed) || fileSet.has(trimmed) || [...symSet].some(s => s.includes(trimmed))) { exists = true; break; }
      }
      if (!exists) {
        const newConf = entry.confidence - 0.3;
        if (newConf < 0.1) purge.run(entry.id);
        else degrade.run(newConf, entry.id);
      }
    }
  } finally { db.close(); }
}

export async function recomputeWeights(repoRoot) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS symbol_weights (symbol TEXT PRIMARY KEY, weight REAL, updated TEXT)");
    db.exec("CREATE TABLE IF NOT EXISTS session_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, action_type TEXT NOT NULL, symbol_or_file TEXT NOT NULL, timestamp TEXT DEFAULT (datetime('now')))");
    const signals = db.prepare("SELECT symbol_or_file, COUNT(*) as cnt FROM session_signals WHERE action_type = 'queried' GROUP BY symbol_or_file ORDER BY cnt DESC LIMIT 200").all();
    const maxCount = signals.length > 0 ? Math.max(...signals.map(s => s.cnt)) : 1;
    const upsert = db.prepare("INSERT OR REPLACE INTO symbol_weights (symbol, weight, updated) VALUES (?, ?, datetime('now'))");
    for (const s of signals) {
      const weight = Math.min(2.0, 0.8 + (s.cnt / Math.max(1, maxCount)) * 1.2);
      upsert.run(s.symbol_or_file, weight);
    }
  } finally { db.close(); }
}

export async function getSymbolWeights(repoRoot) {
  await ensureStateDir(repoRoot);
  const db = openDatabase(repoRoot);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS symbol_weights (symbol TEXT PRIMARY KEY, weight REAL, updated TEXT)");
    const rows = db.prepare("SELECT symbol, weight FROM symbol_weights").all();
    return new Map(rows.map(r => [r.symbol, r.weight]));
  } finally { db.close(); }
}
