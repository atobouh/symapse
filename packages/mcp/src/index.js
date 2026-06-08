import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clarifyRequest,
  computeCanonicalityScores,
  detectAndStorePatterns,
  ensureState,
  findSemanticOverlaps,
  findWhereToIntegrate,
  getArchitectureSummary,
  getContextFiles,
  getConventions,
  getDeadCodeCandidates,
  getFunctionMatches,
  getImpact,
  getStatus,
  listFunctions,
  logSessionSignal,
  queryKnowledge,
  recordSessionQuery,
  refreshIndex,
  startWatcher
} from "../../engine/src/index.js";

const repoRoot = path.resolve(process.env.SYMAPSE_REPO_ROOT || process.argv[2] || fileURLToPath(new URL("../../../", import.meta.url)));
let state = null;
let lastIndexed = null;
let activeWatcher = null;
const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const sessionQueries = [];

function sessionBoost(files, results) {
  if (sessionQueries.length < 2) return files;
  const recentFiles = new Set();
  for (const q of sessionQueries.slice(-3)) {
    for (const sym of q.symbols) {
      if (sym.filePath) recentFiles.add(sym.filePath);
    }
  }
  if (recentFiles.size === 0) return files;
  for (const f of files) {
    if (recentFiles.has(f.file)) f.relevanceScore += 15;
  }
  files.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return files;
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (messageQueue.length > 0) {
      resolve(messageQueue.shift());
      return;
    }
    pendingResolve = resolve;
    pendingReject = reject;
  });
}

let messageQueue = [];
let pendingResolve = null;
let pendingReject = null;
let stdinBuffer = "";

process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk.toString();
  const lines = stdinBuffer.split("\n");
  stdinBuffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (pendingResolve) {
        pendingResolve(msg);
        pendingResolve = null;
        pendingReject = null;
      } else {
        messageQueue.push(msg);
      }
    } catch {
      // Wait for more data
    }
  }
});

process.stdin.resume();

async function ensureIndex() {
  if (state && lastIndexed) {
    const age = Date.now() - lastIndexed;
    if (age < 30000) return state;
  }
  state = await ensureState(repoRoot);
  lastIndexed = Date.now();
  return state;
}

const TOOLS = {
  symapse_ask: {
    name: "symapse_ask",
    description: "Ask what you should know before working on a feature. Routes internally: classifies intent (config vs source vs understanding), clarifies ambiguity, finds where code should go, and surfaces coding conventions. Combines clarify + where + conventions.",
    inputSchema: { type: "object", properties: { description: { type: "string", description: "Feature or task description" } }, required: ["description"] }
  },
  symapse_find: {
    name: "symapse_find",
    description: "Find a symbol and show what it touches. If given a function name, returns location + direct callers/callees + transitive dependencies + impacted files. If given a general query, returns search results. If no query, returns recent changes. Combines search + impact + changes.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Function name or search query (leave empty for recent changes)" } }, required: [] }
  },
  symapse_map: {
    name: "symapse_map",
    description: "Get the map you need. If given a feature description, returns must-read files ranked by relevance. If no description, returns architecture summary (domains, critical nodes, hubs, inter-module flows). Combines context + architecture + overlap.",
    inputSchema: { type: "object", properties: { description: { type: "string", description: "Feature description (leave empty for architecture summary)" } }, required: [] }
  },
  symapse_audit: {
    name: "symapse_audit",
    description: "Audit the codebase. Returns dead code candidates, semantic overlaps (near-duplicate functions), and convention violations. Combines deadcode + overlap + conventions.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max results (default 10)" } }, required: [] }
  },
  symapse_health: {
    name: "symapse_health",
    description: "Index health. Returns file/symbol/edge counts, top files, index status. Use refresh flag to re-index. Combines status + refresh.",
    inputSchema: { type: "object", properties: { refresh: { type: "boolean", description: "Force re-index (default false)" } }, required: [] }
  },
};

async function handleInitialize(_params) {
  return {
    protocolVersion: "2024-11-05",
    serverInfo: {
      name: "symapse-mcp",
      version: "0.1.0"
    },
    capabilities: {
      tools: {}
    }
  };
}

async function handleToolsList() {
  return {
    tools: Object.values(TOOLS)
  };
}

async function handleToolsCall(params) {
  const toolName = params.name;
  const args = params.arguments || {};

  switch (toolName) {
    case "symapse_ask": {
      await ensureIndex();
      const desc = (args.description || "").toLowerCase();
      const where = await findWhereToIntegrate(repoRoot, args.description || "", 2);
      const prior = await queryKnowledge(repoRoot, null);
      const canonicality = await computeCanonicalityScores(repoRoot);
      const state = await ensureState(repoRoot);
      const symbols = state.symbols || [];
      const terms = desc.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !/^the|and|for|that|this|with|from|have|will|what|when|your|how|can|use|want|make|need|like|just|should|would|could$/i.test(w));
      const signals = []; let resolved = [], gaps = [];
      for (const term of terms) {
        const matches = symbols.filter(s => s.name?.toLowerCase().includes(term) || s.qualifiedName?.toLowerCase().includes(term));
        const highCanon = matches.filter(s => (canonicality.get(s.filePath) || 0) >= 0.3);
        const weight = Math.min(1.0, highCanon.length * 0.25);
        signals.push({ term, weight, foundIn: highCanon.slice(0, 3).map(s => s.name) });
        if (weight >= 0.5) resolved.push(term);
        else if (weight <= 0.2) gaps.push({ term, canonicality: weight, note: weight === 0 ? "no existing implementation" : "exists in low-connectivity files" });
      }
      const known = signals.filter(s => s.weight >= 0.5).flatMap(s => s.foundIn);
      const knownCount = new Set(known).size;
      const unknowns = gaps.map(g => g.term);
      const maxCanon = Math.max(...signals.map(s => s.weight), 0);
      const prompt = `Known: ${knownCount} symbols, highest relevance ${Math.round(maxCanon*100)}%. Unknown: ${unknowns.length} terms (${unknowns.join(", ") || "none"}). What does this tell you about the task ahead?`;
      return { content: [{ type: "text", text: JSON.stringify({
        prompt, signals, resolved, graphGaps: gaps,
        relatedSystems: signals.filter(s => s.weight >= 0.3).flatMap(s => s.foundIn).slice(0, 8),
        architecturalTargets: where.candidates?.map(c => ({ module: c.module, risk: c.risk, rationale: c.rationale })) || [],
        priorKnowledge: prior.length > 0 ? prior.slice(0, 3).map(p => p.key + ": " + p.value).join("; ") : null
      }, null, 2) }] };
    }

    case "symapse_find": {
      await ensureIndex();
      const query = args.query || "";
      const canonicality = await computeCanonicalityScores(repoRoot);
      if (!query) {
        const state = await ensureState(repoRoot);
        return { content: [{ type: "text", text: JSON.stringify({ changed: state.changedFunctions?.length || 0, removed: state.removedFunctions?.length || 0 }, null, 2) }] };
      }
      const impact = await getImpact(repoRoot, query);
      if (impact && impact.matchedFunctions?.length > 0) {
        const rankedFiles = [...new Set(impact.impactedFiles || [])].sort((a,b) => (canonicality.get(b)||0) - (canonicality.get(a)||0));
        const dedupedCallers = [...new Set((impact.directCallers || []).map(c => c.qualifiedName))];
        const dedupedCallees = [...new Set((impact.directCallees || []).map(c => c.qualifiedName))];
        return { content: [{ type: "text", text: JSON.stringify({
          symbol: query, location: impact.matchedFunctions[0].filePath + ":" + impact.matchedFunctions[0].startLine,
          directCallers: dedupedCallers,
          directCallees: dedupedCallees,
          impactedFiles: rankedFiles.map(f => ({ file: f, confidence: canonicality.get(f) || 0 })),
          impactfulSymbolCount: impact.impactedSymbols?.length || 0
        }, null, 2) }] };
      }
      const results = await listFunctions(repoRoot, query);
      const ranked = results.sort((a,b) => (canonicality.get(b.filePath)||0) - (canonicality.get(a.filePath)||0));
      return { content: [{ type: "text", text: JSON.stringify({ query, results: ranked.slice(0, 15).map(s => ({ name: s.qualifiedName, kind: s.kind, file: s.filePath, line: s.startLine, canonicality: canonicality.get(s.filePath)||0 })) }, null, 2) }] };
    }

    case "symapse_map": {
      await ensureIndex();
      const desc = args.description || "";
      const canonicality = await computeCanonicalityScores(repoRoot);
      const state = await ensureState(repoRoot);
      if (desc) {
        const ctx = await getContextFiles(repoRoot, desc);
        const where = await findWhereToIntegrate(repoRoot, desc, 2);
        const patterns = await queryKnowledge(repoRoot, "workflow_symbols");
        const matchedPatterns = [];
        for (const p of (patterns || [])) {
          const tokens = desc.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
          const matchCount = tokens.filter(t => p.key.toLowerCase().includes(t)).length;
          if (matchCount >= 1 && parseInt(p.value) >= 3) {
            matchedPatterns.push({ pattern: p.key, sessions: p.value });
          }
        }

        const scored = ctx.files.map(f => ({ ...f, canonicality: canonicality.get(f.file) || 0 }));
        scored.sort((a,b) => b.canonicality - a.canonicality);
        return { content: [{ type: "text", text: JSON.stringify({
          contextFiles: scored.map(f => ({ file: f.file, score: f.relevanceScore, canonicality: f.canonicality, reasons: f.reasons })),
          recommendedModule: where.candidates?.[0] ? { module: where.candidates[0].module, risk: where.candidates[0].risk, rationale: where.candidates[0].rationale } : null,
          workflowPatterns: matchedPatterns.length > 0 ? matchedPatterns.slice(0, 3) : null
        }, null, 2) }] };
      }
      const arch = await getArchitectureSummary(repoRoot);
      const symbols = state.symbols || [];
      const nameToFile = new Map();
      for (const s of symbols) {
        nameToFile.set(s.name, s.filePath);
        nameToFile.set(s.qualifiedName, s.filePath);
      }
      const domains = (arch.domains || []).map(d => {
        const firstFile = nameToFile.get(d.topSymbols?.[0]);
        return { name: d.name, symbols: d.symbolCount, canonicality: canonicality.get(firstFile) || 0 };
      });
      return { content: [{ type: "text", text: JSON.stringify({
        domains: domains.sort((a,b) => b.canonicality - a.canonicality),
        critical: arch.criticalModules?.slice(0, 8)?.map(m => ({ name: m.name, fanIn: m.fanIn, fanOut: m.fanOut })),
        hubs: arch.hubFunctions?.slice(0, 5)?.map(h => ({ name: h.name, module: h.module })),
        flows: arch.interModuleFlows
      }, null, 2) }] };
    }

    case "symapse_audit": {
      await ensureIndex();
      const limit = Number(args.limit || 10);
      const dead = await getDeadCodeCandidates(repoRoot, limit);
      const canonicality = await computeCanonicalityScores(repoRoot);
      const lowCanon = [...canonicality.entries()].filter(([_,s]) => s <= 0.1).sort((a,b) => a[1] - b[1]).slice(0, 8);
      return { content: [{ type: "text", text: JSON.stringify({
        deadCode: dead.candidates?.map(c => ({ name: c.qualifiedName, score: c.score, reasons: c.reasons, file: c.filePath })) || [],
        totalExamined: dead.totalSymbolsExamined,
        lowCanonicalityFiles: lowCanon.length > 0 ? lowCanon.map(([f,s]) => ({ file: f, score: s })) : [],
        canonicalityDistribution: {
          high: [...canonicality.values()].filter(v => v >= 0.5).length,
          medium: [...canonicality.values()].filter(v => v >= 0.1 && v < 0.5).length,
          low: [...canonicality.values()].filter(v => v < 0.1).length
        }
      }, null, 2) }] };
    }

    case "symapse_ask": {
      await ensureIndex();
      const desc = (args.description || "").toLowerCase();
      const where = await findWhereToIntegrate(repoRoot, args.description || "", 2);
      const prior = await queryKnowledge(repoRoot, null);
      const canonicality = await computeCanonicalityScores(repoRoot);

      const state = await ensureState(repoRoot);
      const symbols = state.symbols || [];
      const terms = desc.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !/^the|and|for|that|this|with|from|have|will|what|when|your|how|can|use|want|make|need|like|just|should|would|could$/i.test(w));
      const signals = [];
      let resolved = [], gaps = [];

      for (const term of terms) {
        const matches = symbols.filter(s => s.name?.toLowerCase().includes(term) || s.qualifiedName?.toLowerCase().includes(term));
        const highCanon = matches.filter(s => (canonicality.get(s.filePath) || 0) >= 0.3);
        const weight = Math.min(1.0, highCanon.length * 0.25);

        signals.push({ term, weight, foundIn: highCanon.slice(0, 3).map(s => s.name) });

        if (weight >= 0.5) resolved.push(term);
        else if (weight <= 0.2) {
          gaps.push({ term, canonicality: weight, note: weight === 0 ? "no existing implementation" : "exists in low-connectivity files" });
        }
      }

      const known = signals.filter(s => s.weight >= 0.5).flatMap(s => s.foundIn);
      const knownCount = new Set(known).size;
      const unknowns = gaps.map(g => g.term);
      const topCanonicity = Math.max(...signals.map(s => s.weight), 0);

      const prompt = `Known: ${knownCount} symbols, highest relevance ${Math.round(topCanonicity * 100)}%. Unknown: ${unknowns.length} terms (${unknowns.join(", ") || "none"}). What does this tell you about the task ahead?`;

      const priorKnowledge = prior.length > 0 ? prior.slice(0, 3).map(p => p.key + ": " + p.value).join("; ") : null;

      return { content: [{ type: "text", text: JSON.stringify({
        prompt,
        signals, resolved, graphGaps: gaps,
        relatedSystems: signals.filter(s => s.weight >= 0.3).flatMap(s => s.foundIn).slice(0, 8),
        architecturalTargets: where.candidates?.map(c => ({ module: c.module, risk: c.risk, rationale: c.rationale })) || [],
        priorKnowledge
      }, null, 2) }] };
    }

    case "symapse_health": {
      await ensureIndex();
      if (args.watch) {
        if (activeWatcher) activeWatcher.stop();
        const events = [];
        activeWatcher = await startWatcher(repoRoot, (event) => {
          events.push({ ...event, timestamp: new Date().toISOString() });
          if (events.length > 50) events.shift();
        });
        return { content: [{ type: "text", text: JSON.stringify({ watching: repoRoot, mode: "collision + break + coherence + dead_on_arrival", events: "logged to memory, retrievable via health call", status: "active" }, null, 2) }] };
      }
      if (args.refresh) { await refreshIndex(repoRoot); }
      const status = await getStatus(repoRoot);
      const canonicality = await computeCanonicalityScores(repoRoot);
      const topFiles = (status.topFiles || []).map(f => ({ file: f.filePath, count: f.count, canonicality: canonicality.get(f.filePath) || 0 }));
      topFiles.sort((a,b) => b.canonicality - a.canonicality);
      return { content: [{ type: "text", text: JSON.stringify({
        files: status.summary?.fileCount, symbols: status.summary?.symbolCount,
        edges: status.summary?.edgeCount, topFiles: topFiles.slice(0, 5)
      }, null, 2) }] };
    }

  default:
    return { content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", tool: toolName }) }], isError: true };
  }
}

async function main() {
  while (true) {
    const msg = await readStdin();
    if (!msg) continue;

    const { jsonrpc, id, method, params } = msg;

    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: await handleInitialize(params) });
    } else if (method === "notifications/initialized") {
      // No response needed
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: await handleToolsList() });
    } else if (method === "tools/call") {
      try {
        const result = await handleToolsCall(params);
        send({ jsonrpc: "2.0", id, result });
      } catch (error) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -1, message: error?.message || "Internal error" }
        });
      }
    } else if (method === "shutdown") {
      if (sessionQueries.length >= 3) {
        detectAndStorePatterns(repoRoot, sessionId).catch(() => {});
      }
      send({ jsonrpc: "2.0", id, result: null });
    } else if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
