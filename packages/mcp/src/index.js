import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clarifyRequest,
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
  refreshIndex
} from "../../engine/src/index.js";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";

async function registerWorkspace(repoPath) {
  try {
    const wsDir = path.join(homedir(), ".symapse");
    await fs.mkdir(wsDir, { recursive: true });
    const wsFile = path.join(wsDir, "workspaces.json");
    let data = { workspaces: [] };
    try { data = JSON.parse(await fs.readFile(wsFile, "utf8")); } catch {}
    if (!data.workspaces.find(w => w.path === repoPath)) {
      data.workspaces.push({ path: repoPath, lastUsed: new Date().toISOString() });
    } else {
      data.workspaces.find(w => w.path === repoPath).lastUsed = new Date().toISOString();
    }
    await fs.writeFile(wsFile, JSON.stringify(data, null, 2));
  } catch {}
}

// Register this repo on MCP startup
registerWorkspace(repoRoot);

const repoRoot = path.resolve(process.env.SYMAPSE_REPO_ROOT || process.argv[2] || fileURLToPath(new URL("../../../", import.meta.url)));
let state = null;
let lastIndexed = null;
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
  symapse_search: {
    name: "symapse_search",
    description: "Search for symbols (functions, classes, methods) in the indexed codebase. Returns matching symbols with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query matching symbol name, qualified name, file path, or kind"
        }
      },
      required: ["query"]
    }
  },
  symapse_impact: {
    name: "symapse_impact",
    description: "Analyze the impact of a symbol. Returns direct callers, direct callees, transitive callers/callees, impacted files, and module dependencies.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The function, class, or method name to analyze impact for"
        }
      },
      required: ["name"]
    }
  },
  symapse_deadcode: {
    name: "symapse_deadcode",
    description: "Find likely dead (unused) code in the codebase. Returns candidates sorted by dead-code score with reasons. Test files, entry points, and lifecycle methods are automatically filtered.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of candidates to return (default: 30)"
        }
      },
      required: []
    }
  },
  symapse_changes: {
    name: "symapse_changes",
    description: "Get recently changed symbols since the last index. Returns symbols that were added, modified, or removed with their change reason.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  symapse_status: {
    name: "symapse_status",
    description: "Get the current indexing status. Returns file count, symbol count, edge count, changed count, and top files by symbol count.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  symapse_overlap: {
    name: "symapse_overlap",
    description: "Find semantically similar or overlapping functions in the codebase. Detects functions that may be duplicate implementations, share callees, or have similar structure. Use this before writing new code to check if something similar already exists.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of overlap pairs to return (default: 20)"
        },
        minScore: {
          type: "number",
          description: "Minimum similarity score 0-100 to include (default: 15)"
        }
      },
      required: []
    }
  },
  symapse_architecture: {
    name: "symapse_architecture",
    description: "Get a high-level architectural summary of the repository. Shows domains, critical modules, hub functions (most-called), entry points, and module dependency graph. Use this to understand the repo structure without reading every file.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  symapse_where: {
    name: "symapse_where",
    description: "Recommend where to integrate new code into the existing architecture. Given a feature description or keywords, returns the modules/directories where similar functionality already lives, with risk assessment and module conventions. Use this BEFORE writing new code to find the right architectural home.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Description of the new feature or functionality (e.g. 'notification system', 'auth middleware')"
        }
      },
      required: ["description"]
    }
  },
  symapse_architecture: {
    name: "symapse_architecture",
    description: "Get a high-level architectural summary of the codebase. Returns domains (logical groupings of modules), inter-module dependency flows, critical/hub functions, and entry points. Use this to understand the repo structure before making changes or to onboard onto a new codebase.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  symapse_clarify: {
    name: "symapse_clarify",
    description: "Analyze a feature request for ambiguity before coding. Detects missing decisions, ambiguous terms, relevant existing systems, and architectural fit. Returns a confidence score and questions the agent MUST ask before implementation. Use this BEFORE building anything new to reduce assumptions by ~80%.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The feature request or task description to analyze for ambiguity"
        }
      },
      required: ["description"]
    }
  },
  symapse_context: {
    name: "symapse_context",
    description: "Given a feature description, returns the 3-5 most relevant files that MUST be read before planning or implementing. Uses keyword relevance, caller density, export status, and role detection (handler, router, service, auth, model) to rank files. Use this after symapse_clarify and symapse_where to identify exactly which files to read for implementation details.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The feature or task description to find relevant context files for"
        }
      },
      required: ["description"]
    }
  },
  symapse_refresh: {
    name: "symapse_refresh",
    description: "Re-index the codebase to pick up recent changes. Use this after making edits to update the symbol graph.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  }
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
    case "symapse_search": {
      await ensureIndex();
      const results = await listFunctions(repoRoot, args.query || "");
      const compact = results.slice(0, 25).map((s) => ({
        name: s.qualifiedName,
        kind: s.kind,
        file: s.filePath,
        line: s.startLine,
        exported: s.exported
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ query: args.query, count: results.length, results: compact }, null, 2) }]
      };
    }

    case "symapse_impact": {
      await ensureIndex();
      const impact = await getImpact(repoRoot, args.name || "");
      if (impact) {
        sessionQueries.push({ query: "impact:" + (args.name || ""), symbols: (impact.matchedSymbols || []).map(s => ({ name: s.name, filePath: s.filePath })) });
        for (const s of (impact.matchedSymbols || [])) { logSessionSignal(repoRoot, sessionId, "queried", s.qualifiedName); }
      }
      if (!impact) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "symbol_not_found", query: args.name }, null, 2) }]
        };
      }
      const summary = {
        functionName: impact.functionName,
        matchedCount: impact.matchedSymbols?.length || 0,
        directCallers: impact.directCallers?.map((c) => `${c.qualifiedName} (${c.filePath})`) || [],
        directCallees: impact.directCallees?.map((c) => `${c.qualifiedName} (${c.filePath})`) || [],
        impactedFiles: impact.impactedFiles || [],
        impactedSymbolCount: impact.impactedSymbols?.length || 0,
        transitiveCallersCount: impact.transitiveCallers?.length || 0,
        transitiveCalleesCount: impact.transitiveCallees?.length || 0
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }

    case "symapse_deadcode": {
      await ensureIndex();
      const result = await getDeadCodeCandidates(repoRoot, args.limit || 30);
      const compact = result.candidates.map((c) => ({
        name: c.qualifiedName,
        kind: c.kind,
        file: c.filePath,
        line: c.startLine,
        score: c.score,
        reasons: c.reasons
      }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalExamined: result.totalSymbolsExamined,
            totalCandidates: result.totalCandidates,
            candidates: compact
          }, null, 2)
        }]
      };
    }

    case "symapse_changes": {
      await ensureIndex();
      const s = await ensureState(repoRoot);
      const changed = s.changedFunctions?.map((f) => ({
        name: f.qualifiedName || f.name,
        file: f.filePath,
        reason: f.reason || "unknown"
      })) || [];
      const removed = s.removedFunctions?.map((f) => ({
        name: f.qualifiedName || f.name,
        file: f.filePath,
        reason: f.reason || "removed"
      })) || [];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            changedCount: changed.length,
            removedCount: removed.length,
            changed,
            removed
          }, null, 2)
        }]
      };
    }

    case "symapse_status": {
      await ensureIndex();
      const status = await getStatus(repoRoot);
      const summary = {
        repoRoot: status.repoRoot,
        files: status.summary?.fileCount || 0,
        symbols: status.summary?.symbolCount || 0,
        edges: status.summary?.edgeCount || 0,
        functions: status.summary?.functionCount || 0,
        classes: status.summary?.classCount || 0,
        methods: status.summary?.methodCount || 0,
        changedCount: status.summary?.changedCount || 0,
        removedCount: status.summary?.removedCount || 0,
        initialIndex: status.summary?.initialIndex || false,
        topFiles: (status.topFiles || []).map((f) => ({
          file: f.filePath,
          symbolCount: f.count
        }))
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }

    case "symapse_overlap": {
      await ensureIndex();
      const result = await findSemanticOverlaps(repoRoot, args.limit || 20, args.minScore || 15);
      const compact = result.overlaps.map((p) => ({
        functionA: p.functionA.name,
        functionB: p.functionB.name,
        file: p.functionA.filePath,
        score: p.score,
        signals: p.signals,
        recommendation: p.recommendation,
        sharedCallees: p.sharedCallees
      }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalPairs: result.totalPairs,
            overlaps: compact
          }, null, 2)
        }]
      };
    }

    case "symapse_architecture": {
      await ensureIndex();
      const result = await getArchitectureSummary(repoRoot);
      const compact = {
        domains: result.domains?.map((d) => ({ name: d.name, files: d.fileCount, symbols: d.symbolCount })) || [],
        criticalModules: result.criticalModules?.map((m) => ({ file: m.filePath, symbols: m.symbolCount, importedBy: m.importedByCount, criticality: m.criticality })) || [],
        hubFunctions: result.hubFunctions?.slice(0, 10).map((h) => ({ name: h.qualifiedName, file: h.filePath, inboundCalls: h.inboundCalls })) || [],
        entryPoints: result.entryPoints?.map((e) => ({ name: e.qualifiedName, file: e.filePath })) || [],
        summary: result.summary
      };
      return {
        content: [{ type: "text", text: JSON.stringify(compact, null, 2) }]
      };
    }

    case "symapse_where": {
      await ensureIndex();
      const result = await findWhereToIntegrate(repoRoot, args.description || "", args.limit || 5);
      const compact = {
        query: result.query,
        candidates: result.candidates.map((c) => ({
          module: c.module,
          directory: c.directory,
          symbols: c.symbolCount,
          nearestSymbol: c.nearestSymbol,
          risk: c.risk,
          riskReason: c.riskReason,
          conventions: c.conventions,
          rationale: c.rationale
        })),
        relatedSymbols: result.relatedSymbols?.map((s) => s.name) || []
      };
      return {
        content: [{ type: "text", text: JSON.stringify(compact, null, 2) }]
      };
    }

    case "symapse_architecture": {
      await ensureIndex();
      const result = await getArchitectureSummary(repoRoot);
      const compact = {
        summary: result.summary,
        domainCount: result.domains?.length || 0,
        domains: result.domains?.map((d) => ({
          name: d.name,
          symbols: d.symbolCount,
          exported: d.exportedCount,
          internal: d.internalCount,
          files: d.fileCount,
          top: d.topSymbols
        })),
        criticalModules: result.criticalModules?.slice(0, 8),
        hubFunctions: result.hubFunctions,
        entryPoints: result.entryPoints,
        flows: result.interModuleFlows
      };
      return {
        content: [{ type: "text", text: JSON.stringify(compact, null, 2) }]
      };
    }

    case "symapse_clarify": {
      await ensureIndex();
      const result = await clarifyRequest(repoRoot, args.description || "");
      const prior = await queryKnowledge(repoRoot, null);
      let knowledgeNote = "";
      if (prior.length > 0) {
        const findings = prior.filter(r => r.type === "finding").slice(0, 3);
        const patterns = prior.filter(r => r.type === "pattern").slice(0, 2);
        if (findings.length || patterns.length) {
          knowledgeNote = "\n\n---\n**Prior sessions discovered:**\n";
          for (const f of findings) knowledgeNote += `- ${f.key}: ${f.value}\n`;
          for (const p of patterns) knowledgeNote += `- Pattern: ${p.key} → ${p.value}\n`;
        }
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            request: result.request,
            confidence: result.confidence,
            action: result.action,
            signals: result.signals,
            ambiguousTerms: result.ambiguousTerms,
            missingDecisions: result.missingDecisions,
            relatedSystems: result.relatedSystems.filter((s) => s.score >= 2).map((s) => s.name),
            architecturalTargets: result.architecturalTargets,
            questions: result.questions,
            priorKnowledge: knowledgeNote || null
          }, null, 2)
        }]
      };
    }

    case "symapse_context": {
      await ensureIndex();
      const result = await getContextFiles(repoRoot, args.description || "");
      const boosted = sessionBoost(result.files, []);
      result.files = boosted;
      result.directive = result.directive || "";
      if (sessionQueries.length >= 2) {
        result.directive = result.directive.replace("DO NOT read other files.", "DO NOT read other files. Recent session activity shows you're working near: " + [...new Set(sessionQueries.slice(-3).flatMap(q => q.symbols.map(s => s.name)))].slice(0, 5).join(", ") + ".");
      }
      recordSessionQuery(repoRoot, sessionId, args.description || "", result.files.map(f => f.topSymbols).flat().filter(Boolean));
      sessionQueries.push({ query: args.description || "", symbols: result.files.map(f => ({ name: f.topSymbols[0], filePath: f.file })).filter(s => s.name) });
      return {
        content: [{ type: "text", text: result.directive }]
      };
    }

    case "symapse_refresh": {
      state = await refreshIndex(repoRoot);
      lastIndexed = Date.now();
      const summary = state.summary || {};
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            files: summary.fileCount,
            symbols: summary.symbolCount,
            edges: summary.edgeCount,
            changedCount: summary.changedCount || 0,
            removedCount: summary.removedCount || 0
          }, null, 2)
        }]
      };
    }

    default:
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", tool: toolName }) }],
        isError: true
      };
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
