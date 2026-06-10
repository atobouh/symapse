const fs=require('fs');
let h=fs.readFileSync('packages/engine/src/index.js','utf-8');
const oldStart='let sessionSnapshot = null;';
const newCode = `let sessionSnapshot = null;

export async function startSessionGate(repoRoot) {
  const state = await ensureState(repoRoot);
  const sourceRoot = state.sourceRoot || repoRoot;
  const fileHashes = new Map();
  try {
    const files = await collectFiles(sourceRoot);
    for (const filePath of files) {
      try {
        const source = await fs.readFile(filePath, "utf8");
        fileHashes.set(filePath.replace(sourceRoot, "").replace(/\\\\/g, "/").replace(/^\\//, ""), hashText(source));
      } catch {}
    }
  } catch {}
  sessionSnapshot = { timestamp: new Date().toISOString(), fileHashes, sourceRoot };
  return { status: "gate_open", filesTracked: fileHashes.size };
}

export async function verifySessionGate(repoRoot) {
  if (!sessionSnapshot) return { error: "no active session. Run symapse_health --session start first." };
  const state = await ensureState(repoRoot);
  const sourceRoot = state.sourceRoot || repoRoot;
  const symbols = state.symbols || [];
  const relations = state.relations || [];
  const oldHashes = sessionSnapshot.fileHashes;
  const added = [], modified = [];
  try {
    const files = await collectFiles(sourceRoot);
    for (const filePath of files) {
      try {
        const source = await fs.readFile(filePath, "utf8");
        const np = filePath.replace(sourceRoot, "").replace(/\\\\/g, "/").replace(/^\\//, "");
        const hh = hashText(source);
        const old = oldHashes.get(np);
        if (!old) added.push(np); else if (old !== hh) modified.push(np);
      } catch {}
    }
  } catch {}
  const changed = [...new Set([...added, ...modified])];
  const linked = symbols.filter(s => changed.some(f => s.filePath === f)).map(s => s.qualifiedName);
  const gaps = [];
  for (const sym of symbols) {
    if (!linked.includes(sym.qualifiedName)) continue;
    const cs = relations.filter(r => r.targetId === sym.id && r.kind === "call");
    if (cs.length === 0 && sym.kind === "function" && !sym.exported) {
      gaps.push({ symbol: sym.qualifiedName, callers: 0, note: "no callers in index" });
    }
  }
  const prompt = "You modified " + modified.length + " files, added " + added.length + " files. " + gaps.length + " changed symbols have no callers. What does this tell you about the completeness of this implementation?";
  return {
    sessionDuration: sessionSnapshot.timestamp,
    changedFiles: changed, changedCount: changed.length,
    added: added.slice(0, 20), modified: modified.slice(0, 20),
    changedSymbols: linked.slice(0, 15),
    graphConnectivity: gaps,
    prompt
  };
}`;
const oldIdx=h.indexOf(oldStart);
const oldEnd=h.indexOf('export async function detectAndStorePatterns',oldIdx);
h=h.substring(0,oldIdx)+newCode+'\n\n'+h.substring(oldEnd);
fs.writeFileSync('packages/engine/src/index.js',h);
console.log('done');
