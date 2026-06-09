import { createHash } from "node:crypto";
import { appendFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readIndexState, writeIndexState, ensureSessionSchema, writeSessionSignal, querySessionSignals as dbQuerySessionSignals, storeKnowledge as dbStoreKnowledge, queryKnowledge as dbQueryKnowledge, validateKnowledge as dbValidateKnowledge, recomputeWeights as dbRecomputeWeights, getSymbolWeights as dbGetSymbolWeights } from "../../db/src/store.js";

const ENGINE_VERSION = 15;
const LOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../.symapse/symapse_log.jsonl");

function symapseLog(entry) {
  try { appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n"); } catch { /* silent */ }
}

// ── Constants ──
const DEFAULT_EXTENSIONS = new Set([".js",".jsx",".ts",".tsx",".mts",".cts",".mjs",".cjs",".json",".jsonc",".json5",".md",".markdown",".yml",".yaml",".css",".scss",".less",".html",".htm",".xml",".toml",".ini",".env",".txt",".py",".rb",".go",".rs",".java",".kt",".kts",".cs",".php",".swift",".c",".h",".cxx",".cpp",".hpp",".lua"]);
const NON_SOURCE_EXTENSIONS = new Set([".md",".markdown",".txt",".json",".jsonc",".json5",".yml",".yaml",".css",".scss",".less",".html",".htm",".xml",".toml",".ini",".env",".svg",".png",".jpg",".gif",".lock",".log",".map"]);
const IGNORED_DIRECTORIES = new Set(["node_modules",".git",".symapse","dist","build",".next","__pycache__","vendor","bower_components"]);
const JS_KEYWORDS = new Set(["if","else","for","while","do","switch","case","break","continue","return","throw","try","catch","finally","new","delete","typeof","instanceof","in","of","void","debugger","with","import","export","class","extends","super","this","function","async","await","yield","const","let","var","default","static","public","private","protected"]);
const NOISE_CALLEES = new Set(["push","pop","shift","unshift","slice","splice","concat","map","filter","reduce","forEach","find","findIndex","sort","reverse","indexOf","includes","join","split","trim","toString","toLowerCase","toUpperCase","replace","match","keys","values","entries","has","get","set","delete","clear","length","parse","stringify","log","error","warn","json","then","catch","finally","resolve","reject","bind","call","apply","charAt","charCodeAt","substring","substr","addEventListener","removeEventListener","querySelector","getElementById","createElement","appendChild","removeChild","setAttribute","getAttribute","classList","floor","ceil","round","abs","max","min","random","test","exec","compile","defineProperty","freeze","seal","assign","create","now","parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent","eval","require","setTimeout","setInterval","clearTimeout","console","window","document","global","process","startsWith","endsWith","padStart","padEnd","repeat","trimStart","trimEnd","focus","blur","click","submit","reset","preventDefault","stopPropagation","dispatchEvent","nextTick","emit","on","once","off","assert","equal","deepEqual","ok","strictEqual","readFileSync","writeFileSync","existsSync","mkdirSync","stat","readdir","readFile","writeFile","mkdir","some","every","fromCharCode","fromCodePoint","indexOf","lastIndexOf"]);
const ENTRY_POINT_NAMES = new Set(["main","index","run","start","serve","listen","init","bootstrap","setup","migrate","seed","sync","build","executeCommand","handleRequest","mainFn","root","createApp","createServer","connect","initialize","handler","router","middleware","loader","action","layout","page","route","generate"]);
const LIFECYCLE_NAMES = new Set(["constructor","render","mount","unmount","componentDidMount","componentWillUnmount","componentDidUpdate","getDerivedStateFromProps","getSnapshotBeforeUpdate","shouldComponentUpdate","onInit","ngOnInit","ngOnDestroy","ngAfterViewInit","ngOnChanges","dispose","cleanup","teardown","onMount","onDestroy","create","update","delete","open","close","read","write","resolve","reject","then","catch","finally","next","error","complete","subscribe","unsubscribe"]);
const HANDLER_PATTERNS = new Set(["handle","onPress","onClick","onChange","onSubmit","onFocus","onBlur","onKeyDown","onKeyUp","onScroll","onResize","dispatch","reduce","transform","serialize","deserialize","toJSON","toString","valueOf","inspect","get","set","iterator","next","has","entries","keys","values","length","size","clear","forEach","map","filter","reduce"]);
const TEST_FILE_PATTERNS = /(?:\.(?:test|spec)\.|^test_|^spec_|__tests__|\.test\.|\.spec\.)/;
const TEST_FUNCTION_PATTERNS = /^(?:test|it|describe|beforeEach|afterEach|beforeAll|afterAll|spec|suite|fixture|teardown_|setup_|setUp|tearDown|pytest_)/;
const STRUCTURAL_KEYWORDS = /\b(if|else|for|while|do|switch|case|break|continue|return|throw|try|catch|finally|await|yield|new|delete|typeof|instanceof|in|of|const|let|var|function|class|import|export|default|async|extends|super|this|void|with|debugger)\b/g;
const AMBIGUITY_PATTERNS = {notifications:["email","push","SMS","in-app","slack","webhook"],auth:["JWT","OAuth","session","API key","SSO","basic auth"],export:["CSV","PDF","Excel","JSON","API","email report"],payment:["Stripe","PayPal","MTN MoMo","Orange Money","crypto","invoice","subscription","one-time"],storage:["S3","local","database","CDN","filesystem","cloud"],search:["full-text","Elasticsearch","database","fuzzy","exact","real-time"],cache:["Redis","memory","file","database","CDN","distributed"],queue:["RabbitMQ","Kafka","Redis","database","in-memory"],logging:["console","file","Sentry","DataDog","ELK","custom"],deploy:["Docker","Kubernetes","serverless","VM","bare metal","CI/CD"],database:["PostgreSQL","MySQL","MongoDB","SQLite","Redis","graph"],api:["REST","GraphQL","gRPC","WebSocket","SOAP","tRPC"],migration:["incremental","big bang","dual-write","shadow","phased"],workspace:["owner model","permission model","billing model","isolation level","transfer policy"],role:["admin","editor","viewer","custom","hierarchical","flat"],realtime:["WebSocket","SSE","polling","long-polling","server-sent"],testing:["unit","integration","e2e","visual","load","property-based"]};
const IMPLICATION_MAP = {"add":["where does it live?","does something similar exist?","what naming convention?"],"build":["where does it live?","what does it depend on?","what pattern to follow?"],"migrate":["what depends on the old system?","what needs to change downstream?","parallel run or cut-over?"],"switch":["what depends on the old system?","what's the new interface?","how to handle transition?"],"replace":["what calls this?","what does the new system need to preserve?","backward compatibility?"],"remove":["what calls this?","is anything still importing it?","safe to delete?"],"refactor":["what's the blast radius?","what tests cover this?","safe to change signature?"],"optimize":["what's the bottleneck?","measured or guessed?","what's the performance target?"],"integrate":["what's the interface?","what auth/error handling?","what's the data contract?"],"create":["where does it live?","does something similar exist?","what pattern to follow?"]};
const ROLE_PATTERNS = {handler:/\b(handle|process|execute|run)\w*(Request|Command|Payload|Action|Response|Event)?\b/i,router:/\b(route|router|endpoint|pathname|method|GET|POST|PUT|DELETE|PATCH|req\.method)\b/i,service:/\b(service|manager|repository|provider|helper|utility)\b/i,auth:/\b(auth|login|logout|session|token|password|credential|oauth|jwt)\b/i,model:/\b(model|schema|entity|record|row|column|table|field)\b/i,config:/\b(config|settings|env|environment|constant|default)\b/i,redirect:/\b(redirect|location|href|header|302|301|response\.redirect)\b/i};

// ── Utilities ──
function hashText(text) { return createHash("sha1").update(text).digest("hex"); }
function normalizePath(p) { return p.replace(/\\/g, "/"); }
function isProbablySourceFile(filePath) { const ext = path.extname(filePath); if (NON_SOURCE_EXTENSIONS.has(ext)) return false; return DEFAULT_EXTENSIONS.has(ext); }
function shouldIgnoreRelativePath(relativePath) { return normalizePath(relativePath).split("/").some(s => IGNORED_DIRECTORIES.has(s)); }
function getFileLanguage(filePath) { const l = filePath.toLowerCase(); if (l.endsWith(".py")) return "python"; if (l.endsWith(".go")) return "go"; if (l.endsWith(".rs")) return "rust"; if (l.endsWith(".cs")) return "csharp"; if (l.endsWith(".php") || l.endsWith(".phtml")) return "php"; if (l.endsWith(".rb")) return "ruby"; if (l.endsWith(".c") || l.endsWith(".h")) return "c"; if (l.endsWith(".lua")) return "lua"; return "javascript"; }
function computeLineStarts(source) { const starts = [0]; for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1); return starts; }
function stripBody(symbol) { const { body, bodyHash, key, ...rest } = symbol; return rest; }

async function walk(rootDir, relativeRoot) {
  const entries = [];
  try { const dirEntries = await fs.readdir(path.join(rootDir, relativeRoot), { withFileTypes: true });
    for (const entry of dirEntries) {
      const rel = path.join(relativeRoot, entry.name);
      if (entry.isDirectory()) { if (!shouldIgnoreRelativePath(rel)) entries.push(...await walk(rootDir, rel)); }
      else if (entry.isFile() && isProbablySourceFile(entry.name)) entries.push(path.join(rootDir, rel));
    }
  } catch { /* skip unreadable dirs */ }
  return entries;
}
async function collectFiles(rootDir) { try { const stat = await fs.stat(rootDir); if (stat.isFile()) return isProbablySourceFile(path.basename(rootDir)) ? [rootDir] : []; return walk(rootDir, ""); } catch { return []; } }

// ── Body extraction (brace matching with regex/comment/string awareness) ──
function findMatchingBrace(text, openIndex) {
  let depth = 0, state = "code", quote = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line-comment"; i++; continue; }
      if (c === "/" && n === "*") { state = "block-comment"; i++; continue; }
      if (c === "/" && text[i - 1] !== "\\" && n !== "/" && n !== "*") { state = "regex"; continue; }
      if (c === "\"" || c === "'" || c === "`") { state = "string"; quote = c; continue; }
      if (c === "{") { depth++; continue; }
      if (c === "}") { depth--; if (depth === 0) return i; }
      continue;
    }
    if (state === "line-comment") { if (c === "\n") state = "code"; continue; }
    if (state === "block-comment") { if (c === "*" && n === "/") { state = "code"; i++; } continue; }
    if (state === "regex") { if (c === "\\") { i++; continue; } if (c === "/") { state = "code"; while (i + 1 < text.length && /[gimsuy]/.test(text[i + 1])) i++; } }
    if (state === "string") { if (c === "\\") { i++; continue; } if (c === quote) state = "code"; }
  }
  return -1;
}
function findStatementEnd(source, start) {
  let inString = false, stringChar = null, inTemplate = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) { if (c === "\\") { i++; continue; } if (c === stringChar) inString = false; continue; }
    if (inTemplate) { if (c === "`") { inTemplate = false; continue; } if (c === "$" && source[i + 1] === "{") { i++; let d = 1; while (d > 0 && i + 1 < source.length) { i++; if (source[i] === "{") d++; if (source[i] === "}") d--; } } continue; }
    if (c === "\"" || c === "'") { inString = true; stringChar = c; continue; }
    if (c === "`") { inTemplate = true; stringChar = c; continue; }
    if (c === ";") return i + 1;
    if (c === "\n") return i;
  }
  return source.length;
}

// ── Symbol creation ──
function createSymbol({ body, filePath, kind, name, parentName = "", startLine, endLine, exported = false, isDefault = false }) {
  const q = parentName ? `${parentName}.${name}` : name;
  const k = `${kind}:${filePath}:${q}:${parentName || ""}`;
  return { id: hashText(k), name, qualifiedName: q, kind, filePath, startLine, endLine, exported, isDefault, parentName: parentName || null, key: k, body: body || "", bodyHash: hashText(body || "") };
}

// ── JS/TS extraction ──
function parseImportStatements(source) {
  const stmts = [];
  const ip = /^\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm;
  const si = /^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  const rp = /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/gm;
  const sr = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/gm;
  for (const m of source.matchAll(ip)) stmts.push({ clause: m[1].trim(), specifier: m[2].trim(), raw: m[0] });
  for (const m of source.matchAll(si)) stmts.push({ clause: "", specifier: m[1].trim(), raw: m[0] });
  for (const m of source.matchAll(rp)) stmts.push({ clause: `{ ${m[1].trim()} }`, specifier: m[2].trim(), raw: m[0] });
  for (const m of source.matchAll(sr)) stmts.push({ clause: m[1].trim(), specifier: m[2].trim(), raw: m[0] });
  return stmts;
}
function extractFunctionsAndClasses(source, filePath) {
  const symbols = [], topLevelSymbols = [];
  const fp = [
    { kind: "function", pattern: /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g },
    { kind: "function", pattern: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g }
  ];
  for (const d of fp) {
    d.pattern.lastIndex = 0;
    for (const m of source.matchAll(d.pattern)) {
      const name = m[1]; if (!name) continue;
      const si = m.index ?? 0, sig = m[0];
      const usesFn = /\bfunction\b/.test(sig);
      let bsi = si + sig.length, bei = bsi, bt = "";
      if (usesFn) {
        bsi = si + sig.lastIndexOf("{"); if (bsi < si) continue;
        const cb = findMatchingBrace(source, bsi); if (cb === -1) continue;
        bei = cb + 1; bt = source.slice(bsi + 1, cb);
      } else {
        while (bsi < source.length && /\s/.test(source[bsi])) bsi++;
        if (source[bsi] === "{") { const cb = findMatchingBrace(source, bsi); if (cb === -1) continue; bei = cb + 1; bt = source.slice(bsi + 1, cb); }
        else { bei = findStatementEnd(source, bsi); bt = source.slice(bsi, bei).trim(); }
      }
      const ls = computeLineStarts(source.slice(0, bsi)), es = computeLineStarts(source.slice(0, bei));
      const exp = /^\s*export\s+/.test(sig);
      const sym = createSymbol({ body: bt, filePath, kind: "function", name, startLine: ls.length, endLine: es.length, exported: exp });
      symbols.push(sym); topLevelSymbols.push(sym);
    }
  }
  // class extraction
  const cp = /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b[^{]*\{/g;
  for (const m of source.matchAll(cp)) {
    const name = m[1]; if (!name) continue;
    const si = m.index ?? 0, sig = m[0], bi = si + sig.lastIndexOf("{");
    const cb = findMatchingBrace(source, bi); if (cb === -1) continue;
    const bt = source.slice(bi + 1, cb);
    const ls = computeLineStarts(source.slice(0, bi)), es = computeLineStarts(source.slice(0, cb));
    const exp = /^\s*export\s+/.test(sig);
    const cs = createSymbol({ body: bt, filePath, kind: "class", name, startLine: ls.length, endLine: es.length, exported: exp });
    symbols.push(cs); topLevelSymbols.push(cs);
    // class methods
    const mp = /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
    for (const mm of bt.matchAll(mp)) {
      const mn = mm[1]; if (!mn || /^if$|^while$|^for$|^switch$|^catch$/i.test(mn)) continue;
      const msi = mm.index ?? 0;
      const mb = bt.lastIndexOf("{", msi + mm[0].length);
      const mcb = findMatchingBrace(bt, mb); if (mcb === -1) continue;
      const mbt = bt.slice(mb + 1, mcb);
      const sym = createSymbol({ body: mbt, filePath, kind: "method", name: mn, parentName: name, startLine: ls.length + computeLineStarts(bt.slice(0, msi)).length, endLine: ls.length + computeLineStarts(bt.slice(0, mcb)).length, exported: false });
      symbols.push(sym);
    }
  }
  // export extraction
  const ep = /\bexport\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  for (const m of source.matchAll(ep)) {
    const en = m[1]; if (!en || en === "default") continue;
    for (const s of symbols) if (s.name === en && s.kind === "function") { s.exported = true; s.isDefault = /default/.test(m[0]); }
  }
  symbols.push(createSymbol({ body: source, filePath, kind: "module", name: filePath, startLine: 1, endLine: computeLineStarts(source).length }));
  return { symbols, topLevelSymbols };
}

// ── Python extraction ──
function parsePythonImportStatements(source) {
  const stmts = [], p = /^\s*(?:from\s+([^\s]+)\s+)?import\s+(.+)$/gm;
  for (const m of source.matchAll(p)) {
    const mod = m[1] || "";
    stmts.push({ module: mod.trim(), names: m[2].split(",").map(s => s.trim()).filter(Boolean), raw: m[0] });
  }
  return stmts;
}
function findPythonBlockEnd(lines, startIdx, baseIndent) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)/);
    const indent = m ? m[1].length : 0;
    if (lines[i].trim() === "") continue;
    if (indent <= baseIndent) return i - 1;
  }
  return lines.length - 1;
}
function parsePythonDefinitions(source, filePath) {
  const symbols = [], topLevelSymbols = [], lines = source.split("\n");
  const dp = /^\s*def\s+([A-Za-z_][\w]*)\s*\(/;
  const cp = /^\s*class\s+([A-Za-z_][\w]*)\s*[:\(]/;
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(dp);
    if (d) {
      const name = d[1];
      const indent = (lines[i].match(/^(\s*)/) || [])[1]?.length || 0;
      const end = findPythonBlockEnd(lines, i, indent);
      const bodyLines = lines.slice(i + 1, end + 1);
      const sym = createSymbol({ body: bodyLines.join("\n"), filePath, kind: "function", name, startLine: i + 1, endLine: end + 1, exported: false });
      symbols.push(sym); topLevelSymbols.push(sym); i = end;
    }
    const c = lines[i].match(cp);
    if (c) {
      const name = c[1];
      const indent = (lines[i].match(/^(\s*)/) || [])[1]?.length || 0;
      const end = findPythonBlockEnd(lines, i, indent);
      const bodyLines = lines.slice(i + 1, end + 1);
      const sym = createSymbol({ body: bodyLines.join("\n"), filePath, kind: "class", name, startLine: i + 1, endLine: end + 1, exported: false });
      symbols.push(sym); topLevelSymbols.push(sym); i = end;
    }
  }
  symbols.push(createSymbol({ body: source, filePath, kind: "module", name: filePath, startLine: 1, endLine: lines.length }));
  return { symbols, topLevelSymbols };
}

// ── Language parsers (Go, Rust, C#, PHP, Ruby) ──
function parseSimple(source, filePath, pattern) {
  const syms = [], tops = [];
  for (const m of source.matchAll(pattern)) {
    const name = m[1]?.trim(); if (!name) continue;
    const si = m.index ?? 0, sig = m[0];
    const bi = si + sig.lastIndexOf("{");
    const cb = findMatchingBrace(source, bi); if (cb === -1) continue;
    const bt = source.slice(bi + 1, cb);
    const ls = computeLineStarts(source.slice(0, bi)), es = computeLineStarts(source.slice(0, cb));
    const exp = /^\s*(?:pub|public)\s+/.test(sig);
    const sym = createSymbol({ body: bt, filePath, kind: "function", name, startLine: ls.length, endLine: es.length, exported: exp });
    syms.push(sym); tops.push(sym);
  }
  syms.push(createSymbol({ body: source, filePath, kind: "module", name: filePath, startLine: 1, endLine: computeLineStarts(source).length }));
  return { symbols: syms, topLevelSymbols: tops };
}
function parseGoDefinitions(s, fp) { return parseSimple(s, fp, /\bfunc\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)\s*\([^)]*\)(?:\s*\([^)]*\))?\s*\{/g); }

function parseLuaDefinitions(s, fp) {
  const syms = [], tops = [];
  const fp2 = /\bfunction\s+([A-Za-z_][\w]*(?::[A-Za-z_][\w]*)?(?:\.[A-Za-z_][\w]*)*)\s*\(/g;
  const lf = /\blocal\s+function\s+([A-Za-z_][\w]*)\s*\(/g;
  for (const pattern of [fp2, lf]) {
    for (const m of s.matchAll(pattern)) {
      let name = m[1]?.trim(); if (!name) continue;
      name = name.replace(/:/g, ".");
      const si = m.index ?? 0;
      const ls = computeLineStarts(s.slice(0, si));
      syms.push(createSymbol({ body: "", filePath: fp, kind: "function", name, startLine: ls.length, endLine: ls.length, exported: false }));
    }
  }
  syms.push(createSymbol({ body: "", filePath: fp, kind: "module", name: fp, startLine: 1, endLine: computeLineStarts(s).length }));
  return { symbols: syms, topLevelSymbols: tops };
}

function parseCDefinitions(s, fp) {
  const syms = [], tops = [];
  const pattern = /^\s*(?:SQLITE_PRIVATE\s+)?(?:static\s+)?(?:void|int|char|float|double|long|short|const|unsigned|signed)\s+\*?\s*([A-Za-z_][\w]*)\s*\(/gm;
  for (const m of s.matchAll(pattern)) {
    const name = m[1]?.trim(); if (!name) continue;
    if (/^(if|while|for|switch|return|sizeof)$/.test(name)) continue;
    const si = m.index ?? 0;
    const parenIdx = s.indexOf("(", si) + 1;
    let depth = 1, bi = parenIdx;
    while (bi < s.length && depth > 0) {
      if (s[bi] === "(") depth++;
      else if (s[bi] === ")") depth--;
      bi++;
    }
    while (bi < s.length && /\s/.test(s[bi])) bi++;
    if (s[bi] !== "{") continue;
    const cb = findMatchingBrace(s, bi); if (cb === -1) continue;
    const bt = s.slice(bi + 1, cb);
    const ls = computeLineStarts(s.slice(0, bi)), es = computeLineStarts(s.slice(0, cb));
    const sym = createSymbol({ body: bt, filePath: fp, kind: "function", name, startLine: ls.length, endLine: es.length, exported: name.startsWith("sqlite3_") });
    syms.push(sym); tops.push(sym);
  }
  syms.push(createSymbol({ body: s, filePath: fp, kind: "module", name: fp, startLine: 1, endLine: computeLineStarts(s).length }));
  return { symbols: syms, topLevelSymbols: tops };
}
function parseRustDefinitions(s, fp) {
  const syms = [], tops = [];
  const p = /\b(?:pub\s+(?:\([^)]*\)\s+)?)?fn\s+([A-Za-z_][\w]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->\s*(?:[^{]+?(?:<[^>]*>)?[^{]*?))?\s*\{/g;
  for (const m of s.matchAll(p)) {
    const name = m[1]?.trim(); if (!name || /^(if|while|for|match|loop|fn|let|return)$/.test(name)) continue;
    const si = m.index ?? 0, sig = m[0];
    const bi = si + sig.lastIndexOf("{");
    const cb = findMatchingBrace(s, bi); if (cb === -1) continue;
    const bt = s.slice(bi + 1, cb);
    const ls = computeLineStarts(s.slice(0, bi)), es = computeLineStarts(s.slice(0, cb));
    const exp = /^\s*pub\s+/.test(sig);
    syms.push(createSymbol({ body: bt, filePath: fp, kind: "function", name, startLine: ls.length, endLine: es.length, exported: exp }));
  }
  // impl block methods
  const ip = /\bimpl\b[^{]*\{/g;
  for (const im of s.matchAll(ip)) {
    const isi = im.index ?? 0, isig = im[0];
    const ibi = isi + isig.lastIndexOf("{");
    const icb = findMatchingBrace(s, ibi); if (icb === -1) continue;
    const ibt = s.slice(ibi + 1, icb);
    for (const fm of ibt.matchAll(p)) {
      const name = fm[1]?.trim(); if (!name || /^(if|while|for|match|loop|fn|let|return)$/.test(name)) continue;
      const fbi = ibi + 1 + fm.index + fm[0].lastIndexOf("{");
      const fcb = findMatchingBrace(s, fbi); if (fcb === -1) continue;
      const fbt = s.slice(fbi + 1, fcb);
      const ls = computeLineStarts(s.slice(0, fbi)), es = computeLineStarts(s.slice(0, fcb));
      syms.push(createSymbol({ body: fbt, filePath: fp, kind: "function", name, startLine: ls.length, endLine: es.length, exported: false }));
    }
  }
  syms.push(createSymbol({ body: "", filePath: fp, kind: "module", name: fp, startLine: 1, endLine: computeLineStarts(s).length }));
  return { symbols: syms, topLevelSymbols: tops };
}
function parseCSharpDefinitions(s, fp) { return parseSimple(s, fp, /\b(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed)?\s*(?:[A-Za-z_][\w<>[\],\s]*)\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g); }
function parsePhpDefinitions(s, fp) {
  const syms = [], tops = [];
  const fp2 = /\bfunction\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/g;
  for (const m of s.matchAll(fp2)) {
    const name = m[1]?.trim(); if (!name) continue;
    const si = m.index ?? 0, sig = m[0], bi = si + sig.lastIndexOf("{");
    const cb = findMatchingBrace(s, bi); if (cb === -1) continue;
    const bt = s.slice(bi + 1, cb);
    const ls = computeLineStarts(s.slice(0, bi)), es = computeLineStarts(s.slice(0, cb));
    syms.push(createSymbol({ body: bt, filePath: fp, kind: "function", name, startLine: ls.length, endLine: es.length, exported: false }));
  }
  // REST route callbacks
  const rp = /register_rest_route\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*[^)]*?['"]callback['"]\s*=>\s*(?:array\s*\(\s*(?:[^,]+),\s*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/gi;
  for (const m of s.matchAll(rp)) {
    const mn = m[3] || m[4]; if (!mn) continue;
    const si = m.index ?? 0;
    const ls = computeLineStarts(s.slice(0, si));
    syms.push(createSymbol({ body: `REST: ${m[2]} → ${mn}()`, filePath: fp, kind: "function", name: mn, startLine: ls.length, endLine: ls.length, exported: false }));
  }
  syms.push(createSymbol({ body: s, filePath: fp, kind: "module", name: fp, startLine: 1, endLine: computeLineStarts(s).length }));
  return { symbols: syms, topLevelSymbols: tops };
}
function parseRubyDefinitions(s, fp) {
  const syms = [], tops = [], dp = /\bdef\s+([A-Za-z_][\w?!]*)\b/g;
  for (const m of s.matchAll(dp)) {
    const name = m[1]?.trim(); if (!name) continue;
    const si = m.index ?? 0, bs = si + m[0].length;
    let depth = 0, endIdx = -1;
    const lines = s.slice(bs).split("\n");
    for (let li = 0; li < lines.length; li++) {
      if (/^\s*end\b/.test(lines[li])) { if (depth <= 0) { endIdx = li; break; } depth--; }
      else if (/\b(?:def|class|module|do)\b/.test(lines[li])) depth++;
    }
    if (endIdx === -1) continue;
    const bt = lines.slice(0, endIdx).join("\n");
    const ls = computeLineStarts(s.slice(0, si)), esl = ls.length + endIdx;
    syms.push(createSymbol({ body: bt, filePath: fp, kind: "function", name, startLine: ls.length, endLine: esl, exported: false }));
  }
  syms.push(createSymbol({ body: s, filePath: fp, kind: "module", name: fp, startLine: 1, endLine: computeLineStarts(s).length }));
  return { symbols: syms, topLevelSymbols: tops };
}
function extractSymbolsForFile(source, filePath) {
  const lang = getFileLanguage(filePath);
  if (lang === "python") return parsePythonDefinitions(source, filePath);
  if (lang === "go") return parseGoDefinitions(source, filePath);
  if (lang === "rust") return parseRustDefinitions(source, filePath);
  if (lang === "csharp") return parseCSharpDefinitions(source, filePath);
  if (lang === "php") return parsePhpDefinitions(source, filePath);
  if (lang === "ruby") return parseRubyDefinitions(source, filePath);
  if (lang === "c") return parseCDefinitions(source, filePath);
  if (lang === "lua") return parseLuaDefinitions(source, filePath);
  return extractFunctionsAndClasses(source, filePath);
}

// ── Symbol maps ──
function buildSymbolMap(symbols) {
  const byId = new Map(), byName = new Map(), byQ = new Map(), byFile = new Map();
  for (const s of symbols) {
    byId.set(s.id, s);
    const nb = byName.get(s.name) ?? []; nb.push(s); byName.set(s.name, nb);
    const qb = byQ.get(s.qualifiedName) ?? []; qb.push(s); byQ.set(s.qualifiedName, qb);
    const fb = byFile.get(s.filePath) ?? []; fb.push(s); byFile.set(s.filePath, fb);
  }
  return { byId, byName, byQualifiedName: byQ, byFile };
}

// ── Relations ──
function parseImportAliases(source, fileLanguage) {
  const aliases = new Map();
  if (fileLanguage === "python") {
    for (const st of parsePythonImportStatements(source)) {
      for (const raw of st.names) {
        const parts = raw.split(/\s+as\s+/i);
        aliases.set((parts[1] || parts[0]).trim(), parts[0].trim());
      }
    }
    return aliases;
  }
  for (const st of parseImportStatements(source)) {
    const clause = st.clause.trim(); if (!clause) continue;
    if (clause.startsWith("{")) {
      for (const raw of clause.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean)) {
        const parts = raw.split(/\s+as\s+/i);
        aliases.set((parts[1] || parts[0]).trim(), parts[0].trim());
      }
    } else if (clause !== "*") aliases.set(clause.trim(), clause.trim());
  }
  return aliases;
}
function collectCallTargets(body, knownNames, importAliases) {
  const targets = new Set(); if (!body) return targets;
  const cp = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  const mp = /\b\w+(?:\.|->|::)([A-Za-z_$][\w$]*)\s*\(/g;
  const cbp = /(?:\.(?:map|filter|forEach|find|some|every|reduce|sort|flatMap|then|catch|finally|on|once|addListener|addEventListener|setTimeout|setInterval)|->(?:then|catch|finally|add_action|add_filter|add_shortcode|wp_insert_post|wp_update_post))\s*\(\s*([A-Za-z_$][\w$]*)\s*[),]/g;
  let m;
  while ((m = cp.exec(body)) !== null) { if (!JS_KEYWORDS.has(m[1]) && knownNames.has(m[1])) targets.add(importAliases.get(m[1]) || m[1]); }
  while ((m = mp.exec(body)) !== null) { if (!JS_KEYWORDS.has(m[1]) && knownNames.has(m[1])) targets.add(importAliases.get(m[1]) || m[1]); }
  while ((m = cbp.exec(body)) !== null) { if (!JS_KEYWORDS.has(m[1]) && knownNames.has(m[1])) targets.add(importAliases.get(m[1]) || m[1]); }
  return targets;
}
async function buildRelations({ repoRoot, source, filePath, moduleSymbol, topLevelSymbols, fileIndex, symbolMap }) {
  const relations = [];
  const methodsByClass = new Map();
  const fileLanguage = getFileLanguage(filePath);
  const importAliases = parseImportAliases(source, fileLanguage);
  const knownNames = new Set(symbolMap.byName.keys());

  for (const sym of topLevelSymbols) {
    if (sym.kind !== "method" || !sym.parentName) continue;
    const b = methodsByClass.get(sym.parentName) ?? []; b.push(sym); methodsByClass.set(sym.parentName, b);
  }
  // import relations
  if (fileLanguage === "python") {
    for (const st of parsePythonImportStatements(source)) {
      const res = resolvePythonModuleTarget(st.module, moduleSymbol, fileIndex);
      if (res) relations.push({ kind: "import", label: res, sourceFilePath: filePath, targetFilePath: res, sourceId: moduleSymbol?.id, targetId: "", sourceKind: "module", targetKind: "module", sourceName: filePath, targetName: res });
    }
  } else {
    for (const st of parseImportStatements(source)) {
      const res = resolvePythonModuleTarget(st.specifier, moduleSymbol, fileIndex);
      if (res) relations.push({ kind: "import", label: res, sourceFilePath: filePath, targetFilePath: res, sourceId: moduleSymbol?.id, targetId: "", sourceKind: "module", targetKind: "module", sourceName: filePath, targetName: res });
    }
  }
  // call relations
  for (const sym of topLevelSymbols) {
    if (sym.kind === "module" || !sym.body) continue;
    const targets = collectCallTargets(sym.body, knownNames, importAliases);
    const selfKey = `${sym.kind}:${sym.filePath}:${sym.qualifiedName}:${sym.parentName || ""}`;
    for (const tn of targets) {
      const candidates = symbolMap.byName.get(tn); if (!candidates) continue;
      for (const c of candidates) {
        if (`${c.kind}:${c.filePath}:${c.qualifiedName}:${c.parentName || ""}` === selfKey) continue;
        relations.push({ kind: "call", label: c.qualifiedName, sourceFilePath: sym.filePath, sourceId: sym.id, sourceKind: sym.kind, sourceName: sym.qualifiedName, targetFilePath: c.filePath, targetId: c.id, targetKind: c.kind, targetName: c.qualifiedName });
      }
    }
  }
  return relations;
}
function resolvePythonModuleTarget(specifier, moduleSymbol, fileIndex) {
  if (!specifier) return null;
  const norm = normalizePath(specifier);
  if (fileIndex.has(norm)) return norm;
  if (fileIndex.has(norm + ".py")) return norm + ".py";
  if (fileIndex.has(norm + "/__init__.py")) return norm + "/__init__.py";
  if (fileIndex.has(norm + ".js")) return norm + ".js";
  if (fileIndex.has(norm + ".ts")) return norm + ".ts";
  return null;
}

// ── Graph ──
function buildAdjacency(relations) {
  const ct = new Map(), tc = new Map();
  for (const r of relations) {
    const o = tc.get(r.sourceId) ?? []; o.push(r); tc.set(r.sourceId, o);
    const i = ct.get(r.targetId) ?? []; i.push(r); ct.set(r.targetId, i);
  }
  return { callersByTarget: ct, targetsByCaller: tc };
}
function walkGraph(startIds, adjacency) {
  const visited = new Set(), queue = [...startIds], collected = [];
  while (queue.length) {
    const cur = queue.shift(), neighbors = adjacency.get(cur) ?? [];
    for (const n of neighbors) { if (!visited.has(n.targetId)) { visited.add(n.targetId); collected.push(n); queue.push(n.targetId); } }
  }
  return collected;
}
function buildRelationCounts(symbols, relations) {
  const counts = new Map();
  for (const s of symbols) counts.set(s.id, { incoming: 0, outgoing: 0, importFanIn: 0 });
  for (const r of relations) {
    if (r.kind === "call") {
      const src = counts.get(r.sourceId); if (src) src.outgoing++;
      const tgt = counts.get(r.targetId); if (tgt) tgt.incoming++;
    }
    if (r.kind === "import") {
      const tgt = counts.get(r.targetId);
      if (tgt) tgt.importFanIn++;
    }
  }
  return counts;
}

// ── Indexing ──
const stateCache = new Map();

export async function ensureState(repoRoot) {
  const cached = stateCache.get(repoRoot); if (cached) return cached;
  const existing = await readIndexState(repoRoot);
  if (existing) {
    const syms = existing.symbols ?? existing.functions ?? [];
    existing.byId = new Map(syms.map(s => [s.id, s]));
    existing.byName = new Map(); existing.byQualifiedName = new Map(); existing.byFile = new Map();
    for (const s of syms) {
      const nb = existing.byName.get(s.name) ?? []; nb.push(s); existing.byName.set(s.name, nb);
      const qb = existing.byQualifiedName.get(s.qualifiedName) ?? []; qb.push(s); existing.byQualifiedName.set(s.qualifiedName, qb);
      const fb = existing.byFile.get(s.filePath) ?? []; fb.push(s); existing.byFile.set(s.filePath, fb);
    }
    stateCache.set(repoRoot, existing);
    return existing;
  }
  const state = await indexRepository(repoRoot);
  stateCache.set(repoRoot, state);
  return state;
}

async function getGitChanges(repoRoot) {
  // stub — returns empty for non-git repos
  return [];
}
function compareSnapshots(prev, curr) {
  if (!prev) return { changedFunctions: [], removedFunctions: [] };
  const prevSyms = prev.functions || prev.symbols || [];
  const currSyms = curr.functions || curr.symbols || [];
  const prevById = new Map(prevSyms.map(s => [s.id, s]));
  const currById = new Map(currSyms.map(s => [s.id, s]));
  const changed = [], removed = [];
  for (const [id, s] of currById) {
    const p = prevById.get(id);
    if (!p) changed.push({ ...s, reason: "added" });
    else if (p.bodyHash !== s.bodyHash) changed.push({ ...s, reason: "modified" });
  }
  for (const [id, s] of prevById) { if (!currById.has(id)) removed.push({ ...s, reason: "removed" }); }
  return { changedFunctions: changed, removedFunctions: removed };
}
function summarizeByFile(symbols) {
  const m = new Map();
  for (const s of symbols) { const c = m.get(s.filePath) ?? { filePath: s.filePath, count: 0 }; c.count++; m.set(s.filePath, c); }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

export async function indexRepository(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const targetStat = await fs.stat(resolvedTarget);
  const storageRoot = path.resolve(options.storageRoot || (targetStat.isFile() ? path.dirname(resolvedTarget) : resolvedTarget));
  const sourceRoot = targetStat.isFile() ? path.dirname(resolvedTarget) : resolvedTarget;
  const sourceFiles = targetStat.isFile() ? [resolvedTarget] : await collectFiles(resolvedTarget);
  const previousState = await readIndexState(storageRoot);
  const previousByFile = new Map();
  if (previousState) {
    const ps = previousState.symbols ?? previousState.functions ?? [], pr = previousState.relations ?? previousState.edges ?? [], pf = previousState.files || [];
    for (const f of pf) previousByFile.set(f.path, { hash: f.hash, mtimeMs: f.mtimeMs, size: f.size, symbols: [], relations: [] });
    for (const s of ps) { const b = previousByFile.get(s.filePath); if (b) b.symbols.push(s); }
    for (const r of pr) { const b = previousByFile.get(r.sourceFilePath); if (b) b.relations.push(r); }
  }
  const files = [], allSymbols = [], fileIndex = new Set(), moduleSymbolsByFile = new Map(), filePayloads = [];
  let changedCount = 0, unchangedCount = 0;
  const engineVersionChanged = !previousState || previousState.engineVersion !== ENGINE_VERSION;

  for (const fp of sourceFiles) {
    const fstat = await fs.stat(fp);
    const np = normalizePath(path.relative(sourceRoot, fp));
    fileIndex.add(np);
    const prev = previousByFile.get(np);
    const isUnchanged = !engineVersionChanged && prev && prev.mtimeMs === fstat.mtimeMs && prev.size === fstat.size;

    if (isUnchanged) {
      unchangedCount++;
      files.push({ path: np, hash: prev.hash, mtimeMs: fstat.mtimeMs, size: fstat.size });
      const ms = createSymbol({ body: "", filePath: np, kind: "module", name: np, startLine: 1, endLine: 1 });
      moduleSymbolsByFile.set(np, ms); allSymbols.push(ms);
      for (const s of prev.symbols) allSymbols.push({ ...s });
      continue;
    }
    changedCount++;
    const source = await fs.readFile(fp, "utf8");
    const ch = hashText(source);
    filePayloads.push({ filePath: np, source });
    files.push({ path: np, hash: ch, mtimeMs: fstat.mtimeMs, size: fstat.size });
    const ms = createSymbol({ body: source, filePath: np, kind: "module", name: np, startLine: 1, endLine: computeLineStarts(source).length });
    moduleSymbolsByFile.set(np, ms); allSymbols.push(ms);
  }

  for (const pl of filePayloads) {
    const { symbols: es } = extractSymbolsForFile(pl.source, pl.filePath);
    for (const s of es) allSymbols.push(s);
  }

  const symbolMap = buildSymbolMap(allSymbols);
  const relations = [];

  for (const f of files) {
    const prev = previousByFile.get(f.path);
    if (prev && !engineVersionChanged && prev.hash === f.hash) {
      for (const r of prev.relations) relations.push({ ...r });
    }
  }

  for (const pl of filePayloads) {
    const fs = symbolMap.byFile.get(pl.filePath) ?? [];
    const tls = fs.filter(s => s.kind !== "module");
    const fr = await buildRelations({ fileIndex, filePath: pl.filePath, moduleSymbol: moduleSymbolsByFile.get(pl.filePath), repoRoot: sourceRoot, source: pl.source, symbolMap, topLevelSymbols: tls });
    for (const r of fr) relations.push(r);
  }

  const freqThreshold = Math.max(500, sourceFiles.length * 0.15);
  const callFreq = new Map();
  for (const r of relations) { if (r.kind === "call") callFreq.set(r.targetName, (callFreq.get(r.targetName) || 0) + 1); }
  const noisyTargets = new Set();
  for (const [n, c] of callFreq) { if (c > freqThreshold) noisyTargets.add(n); }
  const filteredRelations = relations.filter(r => r.kind !== "call" || !noisyTargets.has(r.targetName));

  const executableSymbols = allSymbols.filter(s => s.kind !== "module");
  const currentState = {
    indexedAt: new Date().toISOString(), repoRoot: normalizePath(resolvedTarget), storageRoot: normalizePath(storageRoot), sourceRoot: normalizePath(sourceRoot),
    targetKind: targetStat.isFile() ? "file" : "repo", files, functions: allSymbols, symbols: allSymbols, relations: filteredRelations, edges: filteredRelations,
    summary: { fileCount: files.length, functionCount: executableSymbols.filter(s => s.kind === "function").length, classCount: executableSymbols.filter(s => s.kind === "class").length, methodCount: executableSymbols.filter(s => s.kind === "method").length, moduleCount: allSymbols.filter(s => s.kind === "module").length, symbolCount: allSymbols.length, edgeCount: filteredRelations.length, changedCount: 0, removedCount: 0, initialIndex: !previousState, incrementalParsed: changedCount, incrementalSkipped: unchangedCount }
  };
  const { changedFunctions, removedFunctions } = compareSnapshots(previousState, currentState);

  const state = { ...currentState, engineVersion: ENGINE_VERSION, files, changedFunctions, removedFunctions, summary: { ...currentState.summary, changedCount: changedFunctions.length, removedCount: removedFunctions.length, initialIndex: !previousState, incrementalParsed: changedCount, incrementalSkipped: unchangedCount } };
  for (const s of state.symbols) { s.body = ""; s.bodyHash = s.bodyHash || ""; }
  await writeIndexState(storageRoot, state);

  const activeSymbols = (state.symbols || []).map(s => s.qualifiedName).filter(Boolean);
  const activeFiles = (state.symbols || []).map(s => s.filePath).filter(Boolean);
  dbValidateKnowledge(storageRoot, activeSymbols, activeFiles).catch(() => {});
  dbRecomputeWeights(storageRoot).catch(() => {});

  return state;
}

export async function refreshIndex(repoRoot, options = {}) { stateCache.delete(repoRoot); return indexRepository(repoRoot, options); }

export async function logSessionSignal(repoRoot, sessionId, actionType, symbolOrFile) {
  try {
    await writeSessionSignal(repoRoot, sessionId, actionType, symbolOrFile);
  } catch { /* silent */ }
}

export function recordSessionQuery(repoRoot, sessionId, query, symbols) {
  symapseLog({ type: "session_query", session: sessionId, query, symbolCount: symbols.length });
}

export async function storeKnowledge(repoRoot, type, key, value, sessionId) {
  return dbStoreKnowledge(repoRoot, type, key, value, sessionId);
}

export async function queryKnowledge(repoRoot, type) {
  return dbQueryKnowledge(repoRoot, type);
}

export async function computeCanonicalityScores(repoRoot) {
  const state = await ensureState(repoRoot);
  const relations = state.relations ?? state.edges ?? [];
  const symbols = state.symbols ?? state.functions ?? [];

  if (relations.length === 0 || symbols.length === 0) return new Map();

  const edgeCount = new Map();
  for (const rel of relations) {
    if (rel.kind !== "call" && rel.kind !== "import") continue;
    if (rel.sourceFilePath) {
      const s = edgeCount.get(rel.sourceFilePath) ?? { inbound: 0, outbound: 0 };
      s.outbound++;
      edgeCount.set(rel.sourceFilePath, s);
    }
    if (rel.targetFilePath) {
      const t = edgeCount.get(rel.targetFilePath) ?? { inbound: 0, outbound: 0 };
      t.inbound++;
      edgeCount.set(rel.targetFilePath, t);
    }
  }

  const bodyHashes = new Map();
  for (const sym of symbols) {
    if (!sym.bodyHash || sym.kind === "module") continue;
    const bucket = bodyHashes.get(sym.bodyHash) ?? [];
    bucket.push(sym.filePath);
    bodyHashes.set(sym.bodyHash, bucket);
  }

  const maxEdges = Math.max(1, ...[...edgeCount.values()].flatMap(e => [e.inbound, e.outbound]));

  const scores = new Map();
  for (const [file, edges] of edgeCount) {
    let score = (edges.inbound + edges.outbound) / Math.max(1, maxEdges / 10);
    score = Math.min(1.0, Math.max(0.05, score));

    const hash = symbols.find(s => s.filePath === file)?.bodyHash;
    if (hash) {
      const duplicates = bodyHashes.get(hash) || [];
      if (duplicates.length > 1) {
        const betterDuplicate = duplicates.some(dup => {
          const edup = edgeCount.get(dup);
          return dup !== file && edup && (edup.inbound + edup.outbound) > (edges.inbound + edges.outbound);
        });
        if (betterDuplicate) score *= 0.4;
      }
    }
    scores.set(file, Math.round(score * 100) / 100);
  }

  for (const sym of symbols) {
    if (!scores.has(sym.filePath)) {
      scores.set(sym.filePath, 0.01);
    }
  }

  return scores;
}

let globalWatcher = null;
let eventLog = [];

export async function startWatcher(repoRoot, onEvent) {
  if (globalWatcher) globalWatcher.stop();

  const state = await ensureState(repoRoot);
  const sourceRoot = state.sourceRoot || repoRoot;
  const watchers = new Map();
  let running = true;

  function emitEvent(event) {
    const entry = { ...event, timestamp: new Date().toISOString() };
    eventLog.push(entry);
    if (eventLog.length > 500) eventLog.shift();
    try { appendFileSync(path.join(state.storageRoot || repoRoot, ".symapse", "_watch_events.jsonl"), JSON.stringify(entry) + "\n"); } catch {}
    if (onEvent) onEvent(event);
  }

  function readEventLog() {
    const events = [...eventLog];
    return events;
  }

  async function processFile(filePath) {
    if (!running) return;
    try {
      const source = await fs.readFile(filePath, "utf8");
      const normalizedPath = filePath.replace(sourceRoot, "").replace(/\\/g, "/").replace(/^\//, "");
      if (!isProbablySourceFile(normalizedPath)) return;

      const { symbols: newSymbols } = extractSymbolsForFile(source, normalizedPath);
      const existingSymbols = (state.symbols || []).filter(s => s.filePath !== normalizedPath && (s.kind === "function" || s.kind === "method"));
      const relations = state.relations || [];

      for (const sym of newSymbols) {
        if (sym.kind !== "function" && sym.kind !== "method") continue;
        const existingNames = existingSymbols.filter(e => e.qualifiedName !== sym.qualifiedName);
        for (const existing of existingNames.slice(0, 50)) {
          if (!sym.body || !existing.body) continue;
          const a = (sym.body || "").replace(/\s+/g," ").trim().toLowerCase();
          const b = (existing.body || "").replace(/\s+/g," ").trim().toLowerCase();
          if (a.length < 20 || b.length < 20) continue;
          const commonChars = [...a].filter(c => b.includes(c)).length;
          const similarity = commonChars / Math.max(a.length, b.length);
          if (similarity >= 0.6) {
            const callers = relations.filter(r => r.targetId === existing.id && r.kind === "call");
            emitEvent({ type: "collision", written: sym.qualifiedName, existing: existing.qualifiedName, existingFile: existing.filePath, similarity: Math.round(similarity * 100) / 100, existingCallers: callers.length });
            break;
          }
        }
        const existingCallers = relations.filter(r => r.targetId === sym.id && r.kind === "call");
        if (existingCallers.length === 0 && sym.kind === "function" && !sym.exported) {
          emitEvent({ type: "dead_on_arrival", symbol: sym.qualifiedName, callers: 0 });
        }
      }

      for (const extSym of existingSymbols) {
        const callers = relations.filter(r => r.targetId === extSym.id && r.kind === "call");
        if (new Set(newSymbols.map(s => s.qualifiedName)).has(extSym.qualifiedName)) {
          if (callers.length >= 3 && newSymbols.some(ns => ns.name === extSym.name && ns.body !== extSym.body)) {
            const mismatchCount = callers.filter(c => !(c.body || "").includes(extSym.qualifiedName)).length;
            if (mismatchCount >= 2) {
              emitEvent({ type: "break", changed: extSym.qualifiedName, affectedCallers: callers.length, mismatchCount, confidence: Math.min(0.95, mismatchCount / callers.length) });
            }
          }
        }
      }
    } catch {}
  }

  const debounceTimers = new Map();
  function handleChange(filePath) {
    if (!running) return;
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(filePath, setTimeout(() => { debounceTimers.delete(filePath); processFile(filePath); }, 800));
  }

  try {
    const files = await collectFiles(sourceRoot);
    for (const filePath of files) {
      try { watchers.set(filePath, fs.watch(filePath, () => handleChange(filePath))); } catch {}
    }
  } catch {}

  const watcher = {
    stop: () => { running = false; for (const [_, w] of watchers) { try { w.close(); } catch {} } watchers.clear(); },
    events: () => readEventLog(),
    clear: () => { eventLog = []; }
  };
  globalWatcher = watcher;
  return watcher;
}

let sessionSnapshot = null;

export async function startSessionGate(repoRoot) {
  const state = await ensureState(repoRoot);
  const symbols = state.symbols || [];
  const hashes = new Map();
  for (const sym of symbols) {
    hashes.set(sym.id, { bodyHash: sym.bodyHash, name: sym.qualifiedName, file: sym.filePath });
  }
  sessionSnapshot = { timestamp: new Date().toISOString(), hashes };
  return { status: "gate_open", symbolsTracked: hashes.size };
}

export async function verifySessionGate(repoRoot) {
  if (!sessionSnapshot) return { error: "no active session. Run symapse_health --session start first." };

  const state = await ensureState(repoRoot);
  const symbols = state.symbols || [];
  const relations = state.relations || [];
  const oldHashes = sessionSnapshot.hashes;

  const added = [], modified = [], removed = [];
  const currentHash = new Map();
  for (const sym of symbols) {
    currentHash.set(sym.id, sym);
    const old = oldHashes.get(sym.id);
    if (!old) added.push({ symbol: sym.qualifiedName, file: sym.filePath });
    else if (old.bodyHash !== sym.bodyHash) modified.push({ symbol: sym.qualifiedName, file: sym.filePath });
  }
  for (const [id, old] of oldHashes) {
    if (!currentHash.has(id)) removed.push({ symbol: old.name, file: old.file });
  }

  const changedSymbols = [...added, ...modified];
  const changedFiles = [...new Set(changedSymbols.map(s => s.file))].filter(Boolean);

  const graphGaps = [];
  for (const sym of changedSymbols.slice(0, 20)) {
    const callers = relations.filter(r => r.targetId && oldHashes.has(r.targetId) && r.kind === "call");
    if (callers.length === 0) {
      const s = currentHash.get(sym.id) || symbols.find(s2 => s2.qualifiedName === sym.symbol);
      if (s && s.kind === "function" && !s.exported) {
        graphGaps.push({ symbol: sym.symbol, callers: 0, note: "no entry point calls this — may be dead on arrival" });
      }
    }
  }

  const registrationGaps = [];
  for (const sym of changedSymbols.slice(0, 20)) {
    if (sym.symbol && sym.symbol.includes("export")) {
      registrationGaps.push({ symbol: sym.symbol, registered: false, note: "new export not verified — check if consumers exist" });
    }
  }

  const pathIntegrity = [];
  const testCoverage = [];
  for (const file of changedFiles.slice(0, 10)) {
    const testFile = file.replace(/\.(js|ts|py|go|rs|cs|php|rb|lua)$/, ".test.$1")
      .replace("/src/", "/tests/").replace("/lib/", "/tests/");
    const exists = symbols.some(s => s.filePath && s.filePath.includes(testFile));
    testCoverage.push({ file, hasTest: exists });
    if (!exists) pathIntegrity.push({ file, note: "no matching test file found" });
  }

  const totalChanged = changedFiles.length;
  const prompt = `You modified ${changedFiles.length} files, added ${added.length} symbols, modified ${modified.length} symbols. ${graphGaps.length} symbols have no callers. ${testCoverage.filter(t => !t.hasTest).length} files have no test coverage. What does this tell you about the completeness of this implementation?`;

  return {
    sessionDuration: sessionSnapshot.timestamp,
    changedFiles, added: added.map(s => s.symbol), modified: modified.map(s => s.symbol), removed: removed.map(s => s.symbol),
    graphConnectivity: graphGaps,
    registrationGaps,
    testCoverage,
    prompt
  };
}

export async function detectAndStorePatterns(repoRoot, sessionId) {
  const signals = await dbQuerySessionSignals(repoRoot);
  if (!signals || signals.length < 3) return [];

  const sessions = new Map();
  for (const s of signals) {
    if (s.action_type !== "queried") continue;
    const sid = s.session_id;
    const seq = sessions.get(sid) ?? [];
    seq.push(s.symbol_or_file);
    sessions.set(sid, seq);
  }

  const symbolPatterns = new Map();
  for (const [sid, seq] of sessions) {
    if (seq.length < 2) continue;
    for (let i = 0; i < seq.length - 1; i++) {
      const pair = seq.slice(i, i + 2).join(" → ");
      symbolPatterns.set(pair, (symbolPatterns.get(pair) || 0) + 1);
    }
    if (seq.length >= 3) {
      const triplet = seq.slice(0, 3).join(" → ");
      symbolPatterns.set("session:" + triplet, 1);
    }
  }

  const stored = [];
  for (const [seq, count] of symbolPatterns) {
    const threshold = seq.startsWith("session:") ? 1 : 2;
    if (count >= threshold) {
      const key = seq.replace("session:", "");
      await dbStoreKnowledge(repoRoot, "workflow_symbols", key, `${count} sessions followed this symbol sequence`, sessionId);
      stored.push({ key, count });
    }
  }

  return stored;
}

// ── Queries ──
function filterSymbols(state, query) {
  const syms = state.symbols ?? state.functions ?? [];
  if (!query) return syms;
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  if (!tokens.length) return [];

  function match(fields) {
    for (const t of tokens) for (const f of fields) if (f?.includes(t)) return true;
    return false;
  }

  let results = syms.filter(s => match([s.name?.toLowerCase(), s.qualifiedName?.toLowerCase(), s.filePath?.toLowerCase(), s.kind?.toLowerCase()]));

  if (results.length === 0 && tokens.length >= 2) {
    const flattened = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    results = syms.filter(s => {
      const fields = [s.name?.toLowerCase(), s.qualifiedName?.toLowerCase(), s.filePath?.toLowerCase()];
      return fields.some(f => f?.includes(flattened) || (f && flattened.includes(f)));
    });
  }

  if (results.length === 0) {
    results = syms.filter(s => match([(s.filePath || "").toLowerCase()]));
  }

  if (results.length >= 3) {
    const seen = new Map();
    results = results.filter(s => {
      const bh = s.bodyHash || s.endLine || "";
      const prev = seen.get(bh);
      if (prev) {
        const prevIsStale = /\b(?:archive|backup|old|deprecated|\.bak)\b/i.test(prev.filePath);
        const thisIsStale = /\b(?:archive|backup|old|deprecated|\.bak)\b/i.test(s.filePath);
        if (prevIsStale && !thisIsStale) { seen.set(bh, s); return true; }
        if (!prevIsStale && thisIsStale) return false;
      }
      seen.set(bh, s);
      return true;
    });
  }

  return results;
}
export async function listFunctions(repoRoot, query = "") { const s = await ensureState(repoRoot); return filterSymbols(s, query).map(stripBody); }
export async function getFunctionMatches(repoRoot, name) { const s = await ensureState(repoRoot); return filterSymbols(s, name); }
export async function getImpact(repoRoot, name) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const matches = symbols.filter(sym => sym.name === name || sym.qualifiedName === name);
  if (!matches.length) return null;
  const adj = buildAdjacency(relations);
  const directCallers = matches.flatMap(m => (adj.callersByTarget.get(m.id) || []).map(r => symbols.find(sym => sym.id === r.sourceId)).filter(Boolean));
  const directCallees = matches.flatMap(m => (adj.targetsByCaller.get(m.id) || []).map(r => symbols.find(sym => sym.id === r.targetId)).filter(Boolean));
  const transCallers = matches.flatMap(m => walkGraph([m.id], adj.targetsByCaller)).map(r => symbols.find(sym => sym.id === r.sourceId)).filter(Boolean);
  const transCallees = matches.flatMap(m => walkGraph([m.id], adj.callersByTarget)).map(r => symbols.find(sym => sym.id === r.targetId)).filter(Boolean);
  const impacted = [...new Set([...directCallers, ...transCallers, ...matches])];
  const impFiles = [...new Set(impacted.map(s => s.filePath).filter(Boolean))];
  const modDeps = [];
  for (const r of relations) { if (r.kind === "import" && impFiles.includes(r.sourceFilePath) && !impFiles.includes(r.targetFilePath)) modDeps.push(r); }

  return { functionName: name,
    matchedFunctions: matches.map(stripBody), matchedSymbols: matches.map(stripBody),
    directCallers: directCallers.map(stripBody), directCallees: directCallees.map(stripBody),
    transitiveCallers: transCallers.map(stripBody), transitiveCallees: transCallees.map(stripBody),
    impactedFunctions: impacted.map(stripBody), impactedSymbols: impacted.map(stripBody),
    impactedFiles: impFiles, moduleDependencies: modDeps
  };
}

export async function getStatus(repoRoot) {
  const s = await ensureState(repoRoot);
  return { repoRoot: s.repoRoot, storageRoot: s.storageRoot, summary: s.summary, topFiles: summarizeByFile(s.symbols || []).slice(0, 12), changeSource: "git" };
}

// ── Dead code ──
function isTestFile(fp) { return TEST_FILE_PATTERNS.test(fp); }
function isTestFunction(name) { return TEST_FUNCTION_PATTERNS.test(name); }
function isEntryPoint(name, kind) {
  const l = name.toLowerCase();
  if (ENTRY_POINT_NAMES.has(name) || ENTRY_POINT_NAMES.has(l)) return true;
  if (kind === "class" && /(Service|Provider|Controller|Handler|Middleware|Repository|Module|Component|Factory|Manager|Router|Plugin|Extension)$/.test(name)) return true;
  return false;
}
function isLifecycle(name) { return LIFECYCLE_NAMES.has(name); }
function isHandler(name) {
  const l = name.toLowerCase();
  for (const p of HANDLER_PATTERNS) { if (l.startsWith(p.toLowerCase()) || l.endsWith(p.toLowerCase())) return true; }
  return /^(on|handle)[A-Z]/.test(name) || (name.startsWith("_") && name.endsWith("_"));
}
function scoreDeadCodeCandidate(symbol, stats) {
  let sc = 0;
  if (stats.incoming === 0) sc += 70;
  if (stats.outgoing === 0) sc += 15; else if (stats.outgoing <= 2) sc += 8;
  if (!symbol.exported) sc += 10;
  if (symbol.kind === "function") sc += 5; else if (symbol.kind === "method") sc += 3; else if (symbol.kind === "class") sc += 2;
  if (stats.importFanIn >= 2) sc -= 30;
  const fn = (symbol.filePath || "").replace(/\\/g, "/");
  if (isTestFile(fn)) sc -= 40;
  if (isTestFunction(symbol.name)) sc -= 35;
  if (isEntryPoint(symbol.name, symbol.kind)) sc -= 35;
  if (isLifecycle(symbol.name)) sc -= 25;
  if (isHandler(symbol.name)) sc -= 20;
  if (symbol.name === "module" || symbol.name === "exports") sc -= 30;
  return Math.max(0, sc);
}
export async function getDeadCodeCandidates(repoRoot, limit = 30) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const rc = buildRelationCounts(symbols, relations);
  const allowed = new Set(["function", "method", "class"]);
  const candidates = symbols.filter(sym => allowed.has(sym.kind)).map(sym => {
    const stats = rc.get(sym.id); if (!stats) return null;
    const reasons = [];
    if (stats.incoming === 0) reasons.push("no inbound references");
    if (stats.outgoing === 0) reasons.push("no outbound references"); else if (stats.outgoing <= 2) reasons.push("few outbound references");
    if (!sym.exported) reasons.push("not exported");
    if (!reasons.length) return null;
    const sc = scoreDeadCodeCandidate(sym, stats);
    if (sc < 60) return null;
    return { id: sym.id, name: sym.name, qualifiedName: sym.qualifiedName, kind: sym.kind, filePath: sym.filePath, exported: Boolean(sym.exported), startLine: sym.startLine, endLine: sym.endLine, incoming: stats.incoming, outgoing: stats.outgoing, reasons, score: sc };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.incoming - b.incoming || a.qualifiedName.localeCompare(b.qualifiedName));
  const capped = candidates.slice(0, Math.max(1, Number(limit) || 30));
  return { repoRoot: s.repoRoot, storageRoot: s.storageRoot, totalSymbolsExamined: symbols.filter(sym => allowed.has(sym.kind)).length, totalCandidates: candidates.length, candidates: capped };
}

// ── Changes ──
export async function getChanges(repoRoot) {
  await ensureState(repoRoot); return getGitChanges(repoRoot);
}

// ── Tree ──
async function buildRepoTree(rootDir) {
  const files = await collectFiles(rootDir);
  const root = { name: path.basename(rootDir) || "root", type: "directory", children: [], fileCount: 0 };
  for (const f of files) {
    const rel = normalizePath(path.relative(rootDir, f));
    const parts = rel.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) { cur.children.push({ name: parts[i], type: "file" }); cur.fileCount++; }
      else {
        let d = cur.children.find(c => c.name === parts[i] && c.type === "directory");
        if (!d) { d = { name: parts[i], type: "directory", children: [], fileCount: 0 }; cur.children.push(d); }
        cur = d;
      }
    }
  }
  return root;
}
export async function getRepoTree(repoRoot) { return buildRepoTree(repoRoot); }

// ── Overlap engine ──
function jaccardSimilarity(a, b) { if (a.size === 0 && b.size === 0) return 0; const inter = new Set([...a].filter(x => b.has(x))); return inter.size / new Set([...a, ...b]).size; }
function computeCalleeSet(sid, relations) { const c = new Set(); for (const r of relations) { if (r.kind === "call" && r.sourceId === sid) { const sn = (r.targetName || "").split(".").pop(); if (!NOISE_CALLEES.has(sn)) c.add(r.targetId); } } return c; }
function computeImportSet(fp, relations) { const c = new Set(); for (const r of relations) { if (r.kind === "import" && r.sourceFilePath === fp) c.add(r.targetFilePath); } return c; }
function tokenizeBody(body) { return (body || "").replace(/[^A-Za-z0-9_]/g, " ").split(/\s+/).filter(w => w.length > 1).map(w => w.toLowerCase()); }
function bigramSimilarity(a, b) { if (a.length < 2 || b.length < 2) return 0; const sa = new Set(), sb = new Set(); for (let i = 0; i < a.length - 1; i++) { sa.add(`${a[i]}|${a[i + 1]}`); sb.add(`${b[i]}|${b[i + 1]}`); } return jaccardSimilarity(sa, sb); }
function signatureSimilarity(sA, sB, bA, bB) { const la = (bA || "").split("\n").filter(l => l.trim()), lb = (bB || "").split("\n").filter(l => l.trim()); if (!la.length || !lb.length) return 0; return (1 - Math.abs(la.length - lb.length) / Math.max(la.length, lb.length)) * 0.5 + ((/\breturn\b/.test(bA) === /\breturn\b/.test(bB) ? 1 : 0) * 0.2) + ((/\bawait\b/.test(bA) === /\bawait\b/.test(bB) ? 1 : 0) * 0.15) + ((/\bthrow\b/.test(bA) === /\bthrow\b/.test(bB) ? 1 : 0) * 0.15); }
function charTrigramSimilarity(bA, bB) { const norm = t => (t || "").replace(/\s+/g, " ").replace(/[^A-Za-z0-9\s]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); const a = norm(bA), b = norm(bB); if (a.length < 6 || b.length < 6) return 0; const sa = new Set(), sb = new Set(); for (let i = 0; i < a.length - 2; i++) sa.add(a.slice(i, i + 3)); for (let i = 0; i < b.length - 2; i++) sb.add(b.slice(i, i + 3)); return jaccardSimilarity(sa, sb); }
function extractBodySkeleton(body) { const t = []; let m; while ((m = STRUCTURAL_KEYWORDS.exec(body || "")) !== null) t.push(m[1]); return t; }
function skeletonSimilarity(a, b) { if (a.length < 2 || b.length < 2) return 0; const sa = new Set(), sb = new Set(); for (let i = 0; i < a.length - 1; i++) { sa.add(`${a[i]}|${a[i + 1]}`); sb.add(`${b[i]}|${b[i + 1]}`); } if (!sa.size && !sb.size) return 0; return new Set([...sa].filter(x => sb.has(x))).size / new Set([...sa, ...sb]).size; }
function extractLiterals(body) { const lits = new Set(); let m; const sp = /(?:'([^'\\]*(?:\\.[^'\\]*)*)'|\"([^\"\\]*(?:\\.[^\"\\]*)*)\"|`([^`\\]*(?:\\.[^`\\]*)*)`)/g; while ((m = sp.exec(body || "")) !== null) { const v = (m[1] || m[2] || m[3] || "").trim(); if (v.length >= 3) lits.add(v.toLowerCase()); } return lits; }
function literalSimilarity(a, b) { if (!a.size && !b.size) return 0; return new Set([...a].filter(x => b.has(x))).size / new Set([...a, ...b]).size; }
function behavioralSimilarity(bA, bB) { const sa = extractBodySkeleton(bA), sb = extractBodySkeleton(bB); const la = extractLiterals(bA), lb = extractLiterals(bB); const sk = skeletonSimilarity(sa, sb), li = literalSimilarity(la, lb), ch = charTrigramSimilarity(bA, bB); return { skeletonSimilarity: Math.round(sk * 100) / 100, literalSimilarity: Math.round(li * 100) / 100, charTrigramSimilarity: Math.round(ch * 100) / 100, composite: Math.round((sk * 0.4 + li * 0.3 + ch * 0.3) * 100) / 100 }; }
function detectRole(body, name, fp) { const fn = (fp || "").toLowerCase(); if (/template|bridge|redirect/i.test(fn)) return "redirect handler"; if (/auth|login|session/i.test(fn) || /auth|login|session/i.test(name)) return "auth"; if (/service|manager|provider|repository/i.test(fn)) return "service"; if (/router|handler|controller/i.test(fn)) return "router"; if (/model|schema|entity/i.test(fn)) return "model"; if (/config|settings|env/i.test(fn)) return "config"; const t = ((body || "") + " " + name + " " + fp).toLowerCase(); for (const [r, p] of Object.entries(ROLE_PATTERNS)) { if (p.test(t)) return r; } return null; }

export async function findSemanticOverlaps(repoRoot, limit = 20, minScore = 25) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const allowed = new Set(["function", "method", "class"]);
  const execs = symbols.filter(sym => allowed.has(sym.kind));
  if (execs.length < 2) return { repoRoot: s.repoRoot, totalPairs: 0, overlaps: [] };

  const neededFiles = new Set(execs.map(sym => sym.filePath));
  const fileSources = new Map();
  for (const fp of neededFiles) { try { fileSources.set(fp, await fs.readFile(path.resolve(s.repoRoot || "", fp), "utf8")); } catch { fileSources.set(fp, ""); } }
  const lc = new Map();
  function getLineStarts(fp) { if (!lc.has(fp)) lc.set(fp, computeLineStarts(fileSources.get(fp) || "")); return lc.get(fp); }
  function loadBody(sym) { if (sym.body?.length > 0) return sym.body; const src = fileSources.get(sym.filePath); if (!src) return ""; const starts = getLineStarts(sym.filePath); return src.slice(starts[sym.startLine - 1], starts[sym.endLine - 1] + (src.split("\n")[sym.endLine - 1]?.length || 0)); }

  const calleeSets = new Map(), importSets = new Map(), tokenSets = new Map();
  for (const sym of execs) { calleeSets.set(sym.id, computeCalleeSet(sym.id, relations)); const fi = importSets.get(sym.filePath) || computeImportSet(sym.filePath, relations); importSets.set(sym.filePath, fi); tokenSets.set(sym.id, tokenizeBody(loadBody(sym))); }

  const calleeIndex = new Map();
  for (const sym of execs) { const cs = calleeSets.get(sym.id); for (const cid of cs) { const bucket = calleeIndex.get(cid) ?? []; bucket.push(sym); calleeIndex.set(cid, bucket); } }

  const importIndex = new Map();
  for (const sym of execs) { const is = importSets.get(sym.filePath); for (const i of is) { const bucket = importIndex.get(i) ?? []; bucket.push(sym); importIndex.set(i, bucket); } }

  const pairs = [];
  const compared = new Set();
  for (let ia = 0; ia < execs.length; ia++) {
    const a = execs[ia], candidates = new Set();
    for (const cid of calleeSets.get(a.id)) { for (const c of (calleeIndex.get(cid) || [])) candidates.add(c); }
    for (const i of importSets.get(a.filePath)) { for (const c of (importIndex.get(i) || [])) candidates.add(c); }
    for (const b of candidates) {
      if (b === a) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (compared.has(key)) continue;
      compared.add(key);
      if (a.filePath === b.filePath && Math.abs(a.startLine - b.startLine) < 20) continue;
      if (a.filePath === b.filePath && Math.abs(a.startLine - b.startLine) < 20) continue;
      const bA = loadBody(a), bB = loadBody(b);
      const co = jaccardSimilarity(calleeSets.get(a.id), calleeSets.get(b.id));
      const io = jaccardSimilarity(importSets.get(a.filePath), importSets.get(b.filePath));
      const ss = bigramSimilarity(tokenSets.get(a.id), tokenSets.get(b.id));
      const sg = signatureSimilarity(a, b, bA, bB);
      const beh = behavioralSimilarity(bA, bB);
      const ca = calleeSets.get(a.id), cb = calleeSets.get(b.id);
      const mx = Math.max(ca.size, cb.size), sh = new Set([...ca].filter(x => cb.has(x))).size;
      const cw = mx >= 2 && sh >= 2 ? 0.3 : (mx >= 2 ? 0.2 : 0.1);
      const hasSB = beh.composite >= 0.35, hasSK = beh.skeletonSimilarity >= 0.7;
      let clw = cw, sw = 0.2, iw = 0.1, bw = 0.15;
      if (hasSK && beh.composite >= 0.5) { clw = cw * 0.6; bw = 0.3; sw = 0.15; iw = 0.05; }
      else if (hasSB) { bw = 0.25; clw = cw * 0.8; }
      else if (!hasSB && sh < 2) { bw = 0.1; sw = 0.25; iw = 0.15; }
      const tw = clw + sw + iw + bw;
      const sc = Math.round((co * clw + ss * sw + sg * iw + io * iw + beh.composite * bw) / tw * 100);
      const rA = detectRole(bA, a.name, a.filePath), rB = detectRole(bB, b.name, b.filePath);
      const sameRole = rA && rB && rA === rB;
      const fsc = sameRole ? Math.min(100, sc + 20) : sc;
      if (fsc < minScore) continue;
      const sharedCallees = [];
      for (const ci of ca) { if (cb.has(ci)) { const cs = symbols.find(sym => sym.id === ci); if (cs) sharedCallees.push(cs.qualifiedName); } }
      pairs.push({
        functionA: { name: a.qualifiedName, kind: a.kind, filePath: a.filePath, startLine: a.startLine, role: rA },
        functionB: { name: b.qualifiedName, kind: b.kind, filePath: b.filePath, startLine: b.startLine, role: rB },
        score: fsc, roleMatch: sameRole ? rA : null,
        signals: { calleeOverlap: Math.round(co * 100) / 100, structuralSimilarity: Math.round(ss * 100) / 100, signatureSimilarity: Math.round(sg * 100) / 100, importOverlap: Math.round(io * 100) / 100, behavioralSimilarity: beh.composite, skeletonSimilarity: beh.skeletonSimilarity, literalSimilarity: beh.literalSimilarity, charTrigramSimilarity: beh.charTrigramSimilarity },
        sharedCallees: sharedCallees.slice(0, 10),
        recommendation: fsc >= 70 && (sh >= 2 || beh.composite >= 0.4) && ss >= 0.12 ? "merge" : (fsc >= 55 || (beh.composite >= 0.3 && fsc >= 35) ? "review" : "note")
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  return { repoRoot: s.repoRoot, storageRoot: s.storageRoot, totalPairs: pairs.length, overlaps: pairs.slice(0, Math.max(1, Number(limit) || 20)) };
}

// ── Where ──
function extractDirectory(fp) { const n = fp.replace(/\\/g, "/"), i = n.lastIndexOf("/"); return i === -1 ? "" : n.slice(0, i); }
function extractModuleName(fp) { const n = fp.replace(/\\/g, "/"), i = n.lastIndexOf("/"); if (i === -1) return "root"; const fn = n.slice(i + 1), d = n.slice(0, i); if (!d) return fn.replace(/\.[^.]+$/, ""); const parts = d.split("/"); if (parts.includes("packages")) { const pi = parts.indexOf("packages"); if (pi + 1 < parts.length) return parts.slice(pi, parts.length).join("/"); } if (parts.includes("apps")) { const ai = parts.indexOf("apps"); if (ai + 1 < parts.length) return parts.slice(ai, parts.length).join("/"); } return parts.slice(-2).join("/") || "root"; }
function scoreKeywordMatch(kw, text) { if (!text || !kw) return 0; const l = text.toLowerCase(), lk = kw.toLowerCase(); if (l === lk) return 1; if (l.startsWith(lk)) return 0.9; if (l.includes(lk)) return 0.7; for (const w of l.split(/[\/._-]/)) { if (w === lk) return 0.85; if (w.startsWith(lk)) return 0.75; if (w.includes(lk)) return 0.5; } return 0; }

export async function findWhereToIntegrate(repoRoot, description, limit = 5) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const allowed = new Set(["function", "method", "class"]);
  const kw = (description || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 2);
  if (!kw.length) return { repoRoot: s.repoRoot, query: description, candidates: [], note: "no keywords extracted" };

  const allKw = new Set(kw);
  const scored = symbols.filter(sym => allowed.has(sym.kind)).map(sym => { let sc = 0; for (const k of allKw) { sc += scoreKeywordMatch(k, sym.name) * 2 + scoreKeywordMatch(k, sym.qualifiedName) * 1.5 + scoreKeywordMatch(k, sym.filePath) * 1.2; if (sym.body?.toLowerCase().includes(k)) sc += 0.3; } return { symbol: sym, score: sc }; }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8);
  if (!top.length) {
    const mods = new Map();
    for (const sym of symbols) { if (!allowed.has(sym.kind)) continue; const m = extractModuleName(sym.filePath); const b = mods.get(m) ?? { module: m, fileCount: 0, symbolCount: 0, sampleFile: sym.filePath }; b.symbolCount++; mods.set(m, b); }
    return { repoRoot: s.repoRoot, query: description, candidates: [...mods.values()].sort((a,b) => b.symbolCount - a.symbolCount).slice(0, 5).map(m => ({ module: m.module, type: "suggested_folder", rationale: `Largest module (${m.symbolCount} symbols)`, confidence: "low" })), relatedSymbols: [] };
  }
  const cands = [], seen = new Map();
  const rel = top.map(e => ({ name: e.symbol.qualifiedName, kind: e.symbol.kind, filePath: e.symbol.filePath, startLine: e.symbol.startLine, matchScore: Math.round(e.score * 100) / 100 }));
  for (const e of top) {
    const md = extractDirectory(e.symbol.filePath), mn = extractModuleName(e.symbol.filePath);
    if (seen.has(md)) continue; seen.set(md, true);
    const cl = symbols.filter(s2 => allowed.has(s2.kind) && extractDirectory(s2.filePath) === md);
    let risk = "low", rr = "no existing overlap";
    for (const n of cl) { if (scoreKeywordMatch(kw[0], n.name) >= 0.7) { risk = "medium"; rr = `similar: ${n.qualifiedName}`; break; } }
    cands.push({ module: mn, directory: md, type: "suggested_integration", symbolCount: cl.length, matchScore: Math.round(e.score * 100) / 100, nearestSymbol: e.symbol.qualifiedName, conventions: [], risk, riskReason: rr, rationale: `${e.symbol.qualifiedName} lives here — ${cl.length} co-located symbols` });
  }
  return { repoRoot: s.repoRoot, query: description, keywords: [...allKw], candidates: cands.sort((a,b) => a.risk === "low" ? -1 : a.risk === "medium" ? 0 : 1).slice(0, limit), relatedSymbols: rel.slice(0, 10) };
}

// ── Architecture ──
export async function getArchitectureSummary(repoRoot) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const allowed = new Set(["function", "method", "class"]);
  const execs = symbols.filter(sym => allowed.has(sym.kind));
  if (!execs.length) return { repoRoot: s.repoRoot, domains: [], criticalModules: [], hubFunctions: [], entryPoints: [], interModuleFlows: [], summary: "no executable symbols found" };
  const domains = new Map(), fileSetByDom = new Map();
  for (const sym of execs) {
    const mod = extractModuleName(sym.filePath);
    const d = domains.get(mod) ?? { name: mod, symbolCount: 0, exportedCount: 0, internalCount: 0, functionCount: 0, methodCount: 0, classCount: 0, topSymbols: [] };
    d.symbolCount++; if (sym.exported) d.exportedCount++; else d.internalCount++;
    if (sym.kind === "function") d.functionCount++; else if (sym.kind === "method") d.methodCount++; else if (sym.kind === "class") d.classCount++;
    d.topSymbols.push({ name: sym.qualifiedName, kind: sym.kind, exported: sym.exported, line: sym.startLine });
    const fs = fileSetByDom.get(mod) ?? new Set(); fs.add(sym.filePath); fileSetByDom.set(mod, fs);
    domains.set(mod, d);
  }
  for (const [n, d] of domains) { d.fileCount = fileSetByDom.get(n)?.size ?? 0; d.topSymbols = d.topSymbols.filter(x => x.exported).slice(0, 5).map(x => x.name); }
  const interMod = new Map();
  for (const r of relations) { if (r.kind !== "import") continue; const sm = extractModuleName(r.sourceFilePath), tm = extractModuleName(r.targetFilePath); if (sm !== tm) { const k = `${sm}→${tm}`; interMod.set(k, (interMod.get(k) || 0) + 1); } }
  const sortedImports = [...interMod.entries()].sort((a,b) => b[1] - a[1]).slice(0, 12);
  const rc = buildRelationCounts(execs, relations);
  const critical = execs.map(sym => { const st = rc.get(sym.id); return { name: sym.qualifiedName, kind: sym.kind, module: extractModuleName(sym.filePath), filePath: sym.filePath, line: sym.startLine, fanIn: st?.incoming ?? 0, fanOut: st?.outgoing ?? 0, exported: sym.exported }; }).filter(m => m.fanIn >= 2 || m.fanOut >= 2).sort((a,b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut)).slice(0, 15);
  const hubs = critical.filter(m => m.fanIn >= 2 && m.fanOut >= 2).slice(0, 8);
  const eps = execs.map(sym => { const st = rc.get(sym.id); return { name: sym.qualifiedName, kind: sym.kind, module: extractModuleName(sym.filePath), fanIn: st?.incoming ?? 0, fanOut: st?.outgoing ?? 0, exported: sym.exported }; }).filter(e => e.exported && e.fanIn >= 2 && e.fanOut >= 2).sort((a,b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut)).slice(0, 8);
  const dl = [...domains.values()].sort((a,b) => b.symbolCount - a.symbolCount);
  const ds = dl.map(d => `${d.name}: ${d.symbolCount} symbols (${d.exportedCount} exported, ${d.internalCount} internal), ${d.fileCount} files`).join("\n");
  const fs = sortedImports.slice(0, 6).map(([k,c]) => `${k} (${c})`).join(", ") || "no significant import edges";
  const cs = critical.slice(0, 8).map(m => `  ${m.name} (in:${m.fanIn}, out:${m.fanOut}, ${m.module})${m.exported ? " [exported]" : ""}`).join("\n");
  return { repoRoot: s.repoRoot, summary: `Architecture: ${dl.length} domains, ${execs.length} executable symbols\n\nDomains:\n${ds}\n\nInter-module flows:\n${fs}\n\nCritical nodes:\n${cs}`,
    domains: dl.map(d => ({ name: d.name, symbolCount: d.symbolCount, exportedCount: d.exportedCount, internalCount: d.internalCount, functionCount: d.functionCount, methodCount: d.methodCount, classCount: d.classCount, fileCount: d.fileCount, topSymbols: d.topSymbols })),
    criticalModules: critical.map(m => ({ name: m.name, kind: m.kind, module: m.module, fanIn: m.fanIn, fanOut: m.fanOut, exported: m.exported })),
    hubFunctions: hubs.map(h => ({ name: h.name, module: h.module, fanIn: h.fanIn, fanOut: h.fanOut })),
    entryPoints: eps.map(e => ({ name: e.name, module: e.module, fanIn: e.fanIn, fanOut: e.fanOut })),
    interModuleFlows: sortedImports.slice(0, 6).map(([k,c]) => ({ edge: k, count: c }))
  };
}

// ── Conventions ──
export async function getConventions(repoRoot) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const allowed = new Set(["function", "method", "class"]), execs = symbols.filter(sym => allowed.has(sym.kind));
  const byDir = new Map();
  for (const sym of execs) { const d = extractDirectory(sym.filePath); const b = byDir.get(d) ?? { symbols: [], files: new Set() }; b.symbols.push(sym); b.files.add(sym.filePath); byDir.set(d, b); }
  const cl = [];
  for (const [d, b] of byDir) { if (b.symbols.length < 2) continue; const mn = extractModuleName(b.symbols[0].filePath); cl.push({ module: mn, directory: d, fileCount: b.files.size, symbolCount: b.symbols.length, exportedCount: b.symbols.filter(s => s.exported).length, internalCount: b.symbols.filter(s => !s.exported).length }); }
  return { repoRoot: s.repoRoot, domains: cl.sort((a,b) => b.symbolCount - a.symbolCount).slice(0, 15), summary: cl.map(c => `${c.module}: ${c.symbolCount} symbols`).join("\n") };
}

// ── Clarify ──
function classifyIntent(description) {
  const text = (description || "").toLowerCase();

  const configSignals = /\b(turn off|disable|enable|configure|set up|setting|settings?|config|change the|annoying|complaining|stop|suppress|ignore|hide|skip|quiet|silence|make it (stop|not|never|handle|work)|keep (getting|showing|doing)|bother|nag|block|prevent|allow|deny|getting (slow|worse)|customi[sz]e|my (site|app|server|api)|team|rules? (that|they))\b/i;
  const sourceSignals = /\b(add|build|create|implement|extend|modify|rewrite|refactor|migrate|switch|replace|convert|port|write|develop|new (feature|module|plugin|hook|component|class|function))\b/i;
  const understandSignals = /\b(how (does|do|can|could|should|would|is)|explain|what (is|are|does|do|would|should|happening)|why|understand|describe|tell me about|how (would|should) i)\b/i;

  const configScore = (text.match(configSignals) || []).length;
  const sourceScore = (text.match(sourceSignals) || []).length;
  const understandScore = (text.match(understandSignals) || []).length;

  if (configScore > sourceScore && configScore > understandScore) return "config";
  if (sourceScore > configScore && sourceScore > understandScore) return "source";
  if (understandScore > configScore && understandScore > sourceScore) return "understanding";
  if (configScore >= 1 && sourceScore === 0 && understandScore === 0) return "config";
  if (sourceScore >= 1 && configScore === 0 && understandScore === 0) return "source";
  return "source";
}

function findConfigFiles(repoRoot, symbols) {
  const configPatterns = /(\.jsonc?|\.toml|\.yml|\.yaml|\.ini|\.cfg|\.conf|\.env|\.prettierrc|\.eslintrc|ruff\.toml|settings\.py|Makefile|Dockerfile|docker-compose|requirements\.txt|package\.json|\.editorconfig)$/i;
  const docPatterns = /(README|CHANGELOG|CONTRIBUTING|docs?\/|\.md|manual|guide|tutorial)/i;
  const files = new Set();

  for (const sym of symbols) {
    const fp = sym.filePath || "";
    if (configPatterns.test(fp) || docPatterns.test(fp)) {
      files.add(fp);
    }
  }

  const ranked = [...files].sort();
  const configFiles = ranked.filter(f => configPatterns.test(f)).slice(0, 4);
  const docFiles = ranked.filter(f => docPatterns.test(f) && !configPatterns.test(f)).slice(0, 2);

  return { configFiles, docFiles };
}

function detectAmbiguities(description) {
  const text = (description || "").toLowerCase(), detected = [], missing = [];
  for (const [term, opts] of Object.entries(AMBIGUITY_PATTERNS)) { if (text.includes(term)) { detected.push({ term, options: opts, certainty: "low" }); missing.push(`${term}: one of [${opts.join(", ")}]`); } }
  let verb = "build";
  for (const [v, prompts] of Object.entries(IMPLICATION_MAP)) { if (text.startsWith(v) || text.includes(` ${v} `)) { verb = v; for (const p of prompts) { if (!missing.includes(p)) missing.push(p); } break; } }
  return { detected, missingDecisions: missing, verb };
}
export async function clarifyRequest(repoRoot, description) {
  const intent = classifyIntent(description);
  const s = await ensureState(repoRoot);
  const symbols = s.symbols ?? s.functions ?? [];
  const allowed = new Set(["function", "method", "class"]);

  if (intent === "config") {
    const { configFiles, docFiles } = findConfigFiles(repoRoot, symbols);
    return {
      request: description,
      confidence: 95,
      intent,
      message: configFiles.length > 0
        ? `This is a configuration/docs question. The answer is likely in: ${configFiles.join(", ")}. Read those files instead of exploring the source graph.`
        : "This appears to be a configuration or operational question. Look for config files (.toml, .json, .yml) and docs (README, docs/) instead of tracing source code.",
      configFiles,
      docFiles,
      questions: configFiles.length > 0
        ? [`Read ${configFiles.slice(0, 3).join(", ")} for the answer.`]
        : ["Check for config files (pyproject.toml, .eslintrc, etc.) — this doesn't require source code exploration."]
    };
  }

  const amb = detectAmbiguities(description);
  const kw = (description || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
  const related = new Map();
  for (const sym of symbols) { if (!allowed.has(sym.kind)) continue; let sc = 0; for (const k of kw) { if (sym.qualifiedName.toLowerCase().includes(k)) sc += 2; if ((sym.filePath || "").toLowerCase().includes(k)) sc += 1; } if (sc > 0) related.set(sym.qualifiedName, { name: sym.qualifiedName, file: sym.filePath, kind: sym.kind, score: sc }); }
  const topR = [...related.values()].sort((a,b) => b.score - a.score).slice(0, 8);
  const mc = new Map();
  for (const e of topR) { const d = extractDirectory(e.file); if (!mc.has(d)) { mc.set(d, { directory: d, symbolCount: symbols.filter(sym => allowed.has(sym.kind) && extractDirectory(sym.filePath) === d).length, topMatch: e.name }); } }
  const confidence = Math.min(90, Math.max(10, (topR.length >= 3 ? 35 : topR.length ? 20 : 5) + (amb.detected.length <= 1 ? 25 : 10) + (amb.missingDecisions.length <= 3 ? 20 : 5) + (mc.size >= 2 ? 10 : 0)));
  const questions = [];
  if (amb.verb === "migrate" || amb.verb === "switch" || amb.verb === "replace") { questions.push(`What depends on the current ${kw[0] || "system"}? Use symapse_impact.`); questions.push("Parallel migration or cut-over?"); questions.push("Backward compatibility required?"); }
  if (amb.verb === "add" || amb.verb === "build" || amb.verb === "create") { questions.push("Where does similar functionality live? Use symapse_where."); questions.push("What naming convention?"); questions.push("New module or extend existing?"); }
  for (const d of amb.missingDecisions) questions.push(d);
  for (const a of amb.detected) questions.push(`${a.term}: which approach? Options: [${a.options.join(", ")}]`);

    return { request: description,
    intent,
    confidence, action: amb.verb, signals: [], ambiguousTerms: amb.detected.map(a => a.term), missingDecisions: amb.missingDecisions, relatedSystems: topR, architecturalTargets: [...mc.values()].slice(0, 4).map(m => ({ module: m.directory, symbols: m.symbolCount, nearestMatch: m.topMatch })), questions };
}

// ── Context ──
const INTENT_KEYWORDS = new Map([
  ["login","auth"],["logout","auth"],["session","auth"],["auth","auth"],["token","auth"],["password","auth"],["user","auth"],["register","auth"],["account","auth"],
  ["redirect","flow"],["template","flow"],["bridge","flow"],["return","flow"],["callback","flow"],["webhook","flow"],
  ["payment","payment"],["charge","payment"],["invoice","payment"],["order","payment"],["checkout","payment"]
]);

export async function getContextFiles(repoRoot, description, limit = 0) {
  const s = await ensureState(repoRoot), symbols = s.symbols ?? s.functions ?? [], relations = s.relations ?? s.edges ?? [];
  const allowed = new Set(["function", "method", "class", "module"]);
  const kw = (description || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
  if (!kw.length) return { repoRoot: s.repoRoot, query: description, files: [], directive: "no keywords extracted", note: "no keywords" };

  const sourceFiles = new Set(), extCounts = new Map();
  for (const sym of symbols) { if (sym.filePath && sym.kind !== "module") { sourceFiles.add(sym.filePath); const ext = (sym.filePath.split(".").pop() || "").toLowerCase(); extCounts.set(ext, (extCounts.get(ext) || 0) + 1); } }
  const fc = sourceFiles.size;
  let autoLimit = limit > 0 ? limit : 0; if (!autoLimit) { if (fc <= 30) autoLimit = Math.min(3, Math.max(2, Math.ceil(kw.length * 0.7))); else if (fc <= 200) autoLimit = Math.min(5, Math.max(3, Math.ceil(kw.length * 0.8))); else if (fc <= 2000) autoLimit = Math.min(7, Math.max(4, Math.ceil(kw.length * 0.9))); else autoLimit = Math.min(10, Math.max(5, kw.length + 1)); }

  let dominantExt = ""; let maxExt = 0; for (const [e, c] of extCounts) { if (c > maxExt) { maxExt = c; dominantExt = e; } }

  const rc = buildRelationCounts(symbols.filter(sym => allowed.has(sym.kind)), relations);
  const weights = await dbGetSymbolWeights(repoRoot);
  const scored = symbols.filter(sym => allowed.has(sym.kind) && sym.filePath && !sym.filePath.endsWith(".md")).map(sym => {
    let sc = 0; let bh = 0, nh = 0;
    const ln = sym.qualifiedName.toLowerCase(), lf = (sym.filePath || "").toLowerCase(), lb = (sym.body || "").toLowerCase();
    for (const k of kw) { if (ln.includes(k)) { sc += 3; nh++; } if (lb.includes(k)) { sc += 4; bh++; } if (lf.includes(k)) sc += 2; }
    if (nh === 0 && bh === 0) sc = Math.floor(sc * 0.3);
    const st = rc.get(sym.id); const fanIn = st?.incoming ?? 0, fanOut = st?.outgoing ?? 0, tt = fanIn + fanOut;
    if (tt >= 20) sc += 10; else if (tt >= 10) sc += 7; else if (tt >= 5) sc += 4;
    if (sym.kind === "module") sc += 5;
    if (sym.exported) sc += 3;
    const ext = (sym.filePath || "").split(".").pop()?.toLowerCase();
    if (ext && dominantExt && ext !== dominantExt) sc = Math.floor(sc * 0.3);
    const w = weights.get(sym.qualifiedName) || 1.0;
    if (w !== 1.0) sc = Math.round(sc * w);
    const role = detectRole(sym.body, sym.name, sym.filePath);
    return { symbol: sym, score: sc, fanIn, fanOut, role, hasRole: role !== null, bodyHits: bh, nameHits: nh };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);

  const symbolById = new Map(symbols.map(sym => [sym.id, sym]));
  const topTracers = scored.slice(0, 15), tracingMap = new Map();
  for (const e of topTracers) {
    for (const r of relations) {
      if (r.kind === "call" && r.sourceId === e.symbol.id) { const t = symbolById.get(r.targetId); if (t && t.filePath !== e.symbol.filePath) { const ex = tracingMap.get(t.filePath) ?? { boost: 0, symbols: new Set(), reason: "" }; ex.boost += Math.round(e.score * 0.6); ex.symbols.add(t.qualifiedName); ex.reason = e.symbol.qualifiedName; tracingMap.set(t.filePath, ex); } }
      if (r.kind === "import" && r.sourceFilePath === e.symbol.filePath && r.targetFilePath !== e.symbol.filePath) { const ex = tracingMap.get(r.targetFilePath) ?? { boost: 0, symbols: new Set(), reason: "" }; ex.boost += Math.round(e.score * 0.4); ex.reason = e.symbol.filePath; tracingMap.set(r.targetFilePath, ex); }
    }
  }

  const fileScores = new Map();
  for (const e of scored) { const b = fileScores.get(e.symbol.filePath) ?? { file: e.symbol.filePath, totalScore: 0, symbols: [], roles: new Set() }; b.totalScore += e.score; b.symbols.push(e); if (e.role) b.roles.add(e.role); fileScores.set(e.symbol.filePath, b); }
  for (const [fp, tr] of tracingMap) { const b = fileScores.get(fp) ?? { file: fp, totalScore: 0, symbols: [], roles: new Set() }; b.totalScore += tr.boost; if (tr.boost > 0) b.roles.add(`called by ${tr.reason}`); fileScores.set(fp, b); }

  const ranked = [...fileScores.values()].sort((a, b) => b.totalScore - a.totalScore).slice(0, autoLimit);
  const rankedFiles = new Set(ranked.map(r => r.file));
  for (const [fp] of tracingMap) rankedFiles.add(fp);

  const requiredCategories = new Set();
  for (const k of kw) { const cat = INTENT_KEYWORDS.get(k); if (cat) requiredCategories.add(cat); }

  let finalRanked = [...ranked];
  if (requiredCategories.size > 0) {
    const intentCounts = new Map(), fileSymCount = new Map();
    for (const sym of symbols) { if (!allowed.has(sym.kind)) continue; fileSymCount.set(sym.filePath, (fileSymCount.get(sym.filePath) || 0) + 1); }
    for (const sym of symbols) { for (const [ik, ic] of INTENT_KEYWORDS) { if (sym.name.toLowerCase().includes(ik) && requiredCategories.has(ic)) { intentCounts.set(sym.filePath, (intentCounts.get(sym.filePath) || 0) + 1); break; } } }

    const intentBuckets = [];
    for (const [fp, count] of intentCounts) {
      if (rankedFiles.has(fp)) continue;
      const tsc = fileSymCount.get(fp) || 1;
      const density = count / Math.max(1, tsc);
      const bs = Math.min(80, 15 + count * 8);
      const dm = Math.min(2, 0.5 + density * 2);
      const sc = Math.round(bs * dm);
      const b = fileScores.get(fp) ?? { file: fp, totalScore: 0, symbols: [], roles: new Set() };
      b.totalScore = Math.max(b.totalScore, sc);
      b.roles.add(`intent: ${count}/${tsc} symbols`);
      fileScores.set(fp, b);
      intentBuckets.push(b);
    }
    intentBuckets.sort((a, b) => b.totalScore - a.totalScore);
    for (const b of intentBuckets.slice(0, 3)) { if (!finalRanked.includes(b)) finalRanked.push(b); }

    for (const b of intentBuckets.slice(0, 3)) {
      for (const r of relations) {
        if (r.kind === "call" || r.kind === "import") {
          const tf = r.kind === "call" ? (symbolById.get(r.targetId)?.filePath) : r.targetFilePath;
          if (!tf || tf === b.file || rankedFiles.has(tf)) continue;
          const tb = fileScores.get(tf) ?? { file: tf, totalScore: 0, symbols: [], roles: new Set() };
          if (tb.totalScore >= 30) continue;
          tb.totalScore += Math.round(b.totalScore * 0.3);
          fileScores.set(tf, tb);
          if (!finalRanked.includes(tb)) finalRanked.push(tb);
        }
      }
    }
    finalRanked.sort((a, b) => b.totalScore - a.totalScore);
  }

  finalRanked = finalRanked.slice(0, autoLimit + 2);
  const result = finalRanked.map(b => {
    const ts = b.symbols[0];
    const roles = [...b.roles];
    const reasons = [];
    if (roles.length) reasons.push(`role: ${roles.join(", ")}`);
    if (ts?.fanIn >= 5) reasons.push(`highly called (${ts.fanIn} callers)`);
    if (ts?.hasRole) reasons.push(`key symbol: ${ts.symbol.qualifiedName}`);
    const tr = tracingMap.get(b.file);
    if (tr?.boost > 0) reasons.push(`traced from: ${tr.reason} → ${[...tr.symbols].join(", ")}`);
    if (!reasons.length) reasons.push(`matches keywords: ${kw.join(", ")}`);
    return { file: b.file, relevanceScore: b.totalScore, topSymbols: b.symbols.slice(0, 3).map(s => s.symbol.qualifiedName), reasons: reasons.slice(0, 3) };
  });

  let directive = `Based on "${description}", you MUST read these ${result.length} file(s) before planning or implementing:\n\n`;
  for (let i = 0; i < result.length; i++) { directive += `${i + 1}. ${result[i].file}\n   Why: ${result[i].reasons.join(" — ")}\n   Key symbols: ${result[i].topSymbols.join(", ")}\n\n`; }
  directive += "DO NOT read other files. DO NOT use symapse_impact or symapse_search to explore further — those tools tell you structure.\nThese files contain the implementation details. OPEN them NOW and read the relevant functions.\nOnly after reading these files should you form a plan.";

  return { repoRoot: s.repoRoot, query: description, keywords: kw, fileCount: fc, contextualLimit: autoLimit, files: result, directive };
}
