import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureState,
  findSemanticOverlaps,
  findWhereToIntegrate,
  getArchitectureSummary,
  getChanges,
  getDeadCodeCandidates,
  getFunctionMatches,
  getImpact,
  getStatus,
  getRepoTree,
  listFunctions,
  refreshIndex
} from "../../../packages/engine/src/index.js";
import { writeRuntimeInfo, queryKnowledge, querySessionSignals } from "../../../packages/db/src/store.js";

const preferredPort = Number(process.env.PORT || 4580);
const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const publicDir = path.resolve(fileURLToPath(new URL("../../../apps/web/public", import.meta.url)));
const initialTargetPath = path.resolve(process.env.SYMAPSE_REPO_ROOT || defaultRepoRoot);
let runtimePort = preferredPort;
let runtimeBase = `http://localhost:${runtimePort}`;
let startupIndexPromise = null;
let startupIndexError = null;
let latestState = null;
let indexGeneration = 0;
let eventSeq = 0;
const recentEvents = [];
const eventClients = new Set();
let currentTarget = {
  path: initialTargetPath,
  storageRoot: initialTargetPath
};

function createEmptySummary() {
  return {
    fileCount: 0,
    functionCount: 0,
    classCount: 0,
    methodCount: 0,
    moduleCount: 0,
    symbolCount: 0,
    edgeCount: 0,
    changedCount: 0,
    removedCount: 0,
    initialIndex: true
  };
}

function createFallbackStatus() {
  return {
    repoRoot: currentTarget.path,
    storageRoot: currentTarget.storageRoot,
    summary: createEmptySummary(),
    recentChanges: [],
    removedFunctions: [],
    topFiles: [],
    indexing: Boolean(startupIndexPromise) && !latestState && !startupIndexError,
    indexError: startupIndexError,
    targetPath: currentTarget.path
  };
}

async function writeRuntime(extra = {}, target = currentTarget) {
  await writeRuntimeInfo(target.storageRoot, {
    repoRoot: target.path,
    storageRoot: target.storageRoot,
    apiBase: runtimeBase,
    apiPort: runtimePort,
    webBase: runtimeBase,
    webPort: runtimePort,
    updatedAt: new Date().toISOString(),
    indexing: Boolean(startupIndexPromise) && !latestState && !startupIndexError,
    targetPath: target.path,
    ...extra
  });
}

async function normalizeTargetDescriptor(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const stat = await fs.stat(resolvedPath);
  return {
    path: resolvedPath,
    storageRoot: stat.isFile() ? path.dirname(resolvedPath) : resolvedPath
  };
}

async function startIndexing(targetPath = currentTarget.path, storageRoot = currentTarget.storageRoot) {
  const target = {
    path: path.resolve(targetPath),
    storageRoot: path.resolve(storageRoot || targetPath)
  };
  currentTarget = target;
  const generation = ++indexGeneration;
  startupIndexError = null;
  latestState = null;
  const targetLabel = target.path;

  startupIndexPromise = (async () => {
    console.log(`[symapse] indexing repo ${targetLabel}`);
    try {
      const state = await refreshIndex(targetLabel, { storageRoot: target.storageRoot });
      if (generation !== indexGeneration) {
        return state;
      }

      latestState = state;
      startupIndexError = null;
      const runtimeState = {
        indexing: false,
        indexedAt: new Date().toISOString(),
        summary: state.summary,
        indexError: null,
        targetPath: target.path,
        storageRoot: target.storageRoot
      };
      console.log(
        `[symapse] indexed ${state.summary.fileCount} files | ${state.summary.symbolCount} symbols | ${state.summary.edgeCount} edges`
      );
      await writeRuntime(runtimeState, target);
      return state;
    } catch (error) {
      if (generation !== indexGeneration) {
        return null;
      }

      startupIndexError = error?.message ?? "Unknown error";
      console.error(error);
      await writeRuntime({
        indexing: false,
        indexError: startupIndexError,
      }, target);
      return null;
    }
  })();

  return startupIndexPromise;
}

async function waitForIndexing() {
  if (startupIndexPromise) {
    await startupIndexPromise;
  }
}

function sanitizeEvent(event) {
  return {
    id: event.id,
    type: event.type,
    level: event.level,
    tag: event.tag,
    text: event.text,
    detail: event.detail ?? "",
    view: event.view ?? null,
    command: event.command ?? null,
    clientId: event.clientId ?? null,
    data: event.data ?? null,
    time: event.time
  };
}

function broadcastEvent(event) {
  const payload = sanitizeEvent({
    id: ++eventSeq,
    time: new Date().toISOString(),
    ...event
  });

  recentEvents.push(payload);
  if (recentEvents.length > 500) {
    recentEvents.splice(0, recentEvents.length - 500);
  }

  const data = `id: ${payload.id}\nevent: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    try {
      client.write(data);
    } catch {
      eventClients.delete(client);
    }
  }

  return payload;
}

function broadcastClear(clientId = null) {
  return broadcastEvent({
    type: "clear",
    level: "action",
    tag: "ACTION",
    text: "screen cleared",
    clientId
  });
}

function emitLine(level, tag, text, detail = "", extra = {}) {
  return broadcastEvent({
    type: "line",
    level,
    tag,
    text,
    detail,
    ...extra
  });
}

function tokenizeCommand(input) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;

  while ((match = pattern.exec(String(input || ""))) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  return tokens;
}

function formatCount(value, singular, plural = `${singular}s`) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? singular : plural}`;
}


async function getCompactStatus() {
  if (startupIndexError) {
    return createFallbackStatus();
  }

  if (!latestState) {
    return createFallbackStatus();
  }

  const status = await getStatus(currentTarget.storageRoot);
  return {
    ...status,
    indexing: false,
    indexError: null,
    targetPath: currentTarget.path,
    storageRoot: currentTarget.storageRoot
  };
}

async function executeCommand(rawCommand, options = {}) {
  const command = String(rawCommand || "").trim();
  const clientId = options.clientId ?? null;
  const tokens = tokenizeCommand(command);
  const name = (tokens[0] || "").toLowerCase();
  const argText = tokens.slice(1).join(" ").trim();

  if (!name) {
    return {
      ok: true,
      command,
      view: "status",
      events: []
    };
  }

  const events = [];
  const push = (event) => {
    const payload = broadcastEvent({
      ...event,
      command,
      clientId
    });
    events.push(payload);
    return payload;
  };

  push({
    type: "line",
    level: "action",
    tag: "ACTION",
    text: `symapse> ${command}`
  });

  switch (name) {
    case "help": {
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "help",
        text: [
          "help                               show this message",
          "status                             refresh status",
          "tree                               print a compact repo tree",
          "changes                            print recent git changes",
          "deadcode [limit]                   scan for unused or likely dead code",
          "overlap [limit]                    find semantically similar functions",
          "where <description>                find the best module to integrate new code",
          "architecture                       print architectural domain summary",
          "impact <name>                      inspect callers, callees, and impacted files",
          "target <path>                      switch to a repo or single file",
          "refresh                            re-index the current target",
          "clear                              clear the terminal log"
        ].join("\n")
      });
      return { ok: true, command, view: "help", events };
    }

    case "status": {
      const status = await getCompactStatus();
      const summary = status.summary || {};
      push({
        type: "block",
        level: status.indexing ? "warn" : "ok",
        tag: status.indexing ? "WARN" : "OK",
        view: "status",
        data: status,
        text: [
          `indexed ${formatCount(summary.fileCount || 0, "file")} | ${formatCount(summary.symbolCount || 0, "symbol")} | ${formatCount(summary.edgeCount || 0, "edge")}`,
          `target: ${status.targetPath || status.repoRoot || currentTarget.path}`,
          `indexing: ${status.indexing ? "yes" : "no"}`
        ].join("\n")
      });
      return { ok: true, command, view: "status", data: status, events };
    }

    case "tree": {
      const tree = await getRepoTree(currentTarget.path);
      const lines = [];

      function flatten(node, depth = 0) {
        if (!node || lines.length >= 240) {
          return;
        }

        const indent = "  ".repeat(depth);
        if (node.type === "directory") {
          lines.push(`${indent}[${node.name || "repo"}] ${formatCount(node.fileCount || 0, "file")}`);
          for (const child of node.children || []) {
            flatten(child, depth + 1);
            if (lines.length >= 240) {
              lines.push(`${indent}... truncated ...`);
              break;
            }
          }
          return;
        }

        lines.push(`${indent}- ${node.path || node.name || "file"}`);
      }

      flatten(tree);
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "tree",
        data: tree,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "tree", data: tree, events };
    }

    case "changes": {
      const changes = await getChanges(currentTarget.storageRoot);
      const lines = (changes || []).slice(0, 120).map((change) => {
        const pathText = change.renamedFrom ? `${change.path} <- ${change.renamedFrom}` : change.path;
        return `[${String(change.status || "modified").toUpperCase()}] ${pathText}`;
      });
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "changes",
        data: changes,
        text: lines.length ? lines.join("\n") : "no git changes."
      });
      return { ok: true, command, view: "changes", data: changes, events };
    }

    case "deadcode": {
      await waitForIndexing();
      const limit = Number(tokens[1] || 30);
      const result = await getDeadCodeCandidates(currentTarget.storageRoot, limit);
      const lines = [`dead code candidates: ${formatCount(result.totalCandidates || 0, "item")}`];
      for (const candidate of (result.candidates || []).slice(0, 120)) {
        lines.push(
          `${String(candidate.kind || "symbol").toUpperCase()} ${candidate.qualifiedName} :: ${candidate.filePath} :: ${candidate.reasons.join(", ")}`
        );
      }
      push({
        type: "block",
        level: result.totalCandidates ? "warn" : "ok",
        tag: result.totalCandidates ? "WARN" : "OK",
        view: "deadcode",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "deadcode", data: result, events };
    }

    case "overlap": {
      await waitForIndexing();
      const limit = Number(tokens[1] || 20);
      const result = await findSemanticOverlaps(currentTarget.storageRoot, limit, 15);
      const lines = [`semantic overlaps: ${formatCount(result.totalPairs || 0, "pair")}`];
      for (const pair of (result.overlaps || []).slice(0, 60)) {
        const sig = `C:${pair.signals.calleeOverlap} S:${pair.signals.structuralSimilarity} I:${pair.signals.importOverlap}`;
        lines.push(
          `[${String(pair.recommendation).toUpperCase()}] ${pair.functionA.name} <> ${pair.functionB.name} :: score ${pair.score} :: ${sig}`
        );
      }
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "overlap",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "overlap", data: result, events };
    }

    case "architecture": {
      await waitForIndexing();
      const result = await getArchitectureSummary(currentTarget.storageRoot);
      const lines = [];
      lines.push("=== DOMAINS ===");
      for (const d of result.domains || []) {
        lines.push(`  ${d.name} :: ${d.fileCount} files, ${d.symbolCount} symbols`);
      }
      lines.push("");
      lines.push("=== CRITICAL MODULES ===");
      for (const m of (result.criticalModules || [])) {
        lines.push(`  ${m.filePath} :: ${m.symbolCount} symbols, imported by ${m.importedByCount}, criticality ${m.criticality}`);
      }
      lines.push("");
      lines.push("=== HUB FUNCTIONS (most called) ===");
      for (const h of (result.hubFunctions || []).slice(0, 10)) {
        lines.push(`  ${h.qualifiedName} (${h.filePath}) :: ${h.inboundCalls} callers`);
      }
      if (result.entryPoints?.length) {
        lines.push("");
        lines.push("=== ENTRY POINTS ===");
        for (const e of result.entryPoints) {
          lines.push(`  ${e.qualifiedName} :: ${e.filePath}`);
        }
      }
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "architecture",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "architecture", data: result, events };
    }

    case "featureplan": {
      await waitForIndexing();
      const result = await planFeature(currentTarget.storageRoot, argText);
      const lines = [];
      lines.push(`feature plan for: "${argText}"`);
      lines.push(`matches found: ${result.matchCount}`);
      if (result.potentialDuplicates?.length) {
        lines.push("");
        lines.push("=== POTENTIAL DUPLICATES (check before implementing) ===");
        for (const d of result.potentialDuplicates) {
          lines.push(`  ${d.qualifiedName} (${d.filePath}) :: ${d.reason}`);
        }
      }
      if (result.reuseTargets?.length) {
        lines.push("");
        lines.push("=== REUSE TARGETS ===");
        for (const r of result.reuseTargets) {
          lines.push(`  ${r.qualifiedName} (${r.filePath})`);
        }
      }
      if (result.recommendation) {
        lines.push("");
        lines.push(`=== RECOMMENDED HOME: ${result.recommendation.recommendedFile} ===`);
        for (const n of result.recommendation.neighboringFunctions.slice(0, 8)) {
          lines.push(`  ${n.qualifiedName} (line ${n.line})`);
        }
      }
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "featureplan",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "featureplan", data: result, events };
    }

    case "where": {
      await waitForIndexing();
      const query = tokens.slice(1).join(" ") || "";
      const result = await findWhereToIntegrate(currentTarget.storageRoot, query);
      const lines = [`where: "${query || "(empty)"}"`];
      for (const candidate of (result.candidates || [])) {
        lines.push(`  [${(candidate.risk || "?").toUpperCase()}] ${candidate.module} :: ${candidate.rationale || ""}`);
        if (candidate.conventions?.length) {
          lines.push(`    conventions: ${candidate.conventions.join(", ")}`);
        }
      }
      if (result.relatedSymbols?.length) {
        lines.push(`related: ${result.relatedSymbols.map((s) => s.name).join(", ")}`);
      }
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "where",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "where", data: result, events };
    }

    case "architecture": {
      await waitForIndexing();
      const result = await getArchitectureSummary(currentTarget.storageRoot);
      const lines = [result.summary];
      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "architecture",
        data: result,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "architecture", data: result, events };
    }

    case "impact": {
      await waitForIndexing();
      const name = argText;
      const impact = await getImpact(currentTarget.storageRoot, name);

      if (!impact) {
        push({
          type: "line",
          level: "bad",
          tag: "ERR",
          view: "impact",
          text: `function not found: ${name}`
        });
        return { ok: false, command, view: "impact", error: "function_not_found", events };
      }

      const lines = [
        `impact focus: ${name}`,
        `matched symbols: ${formatCount(impact.matchedSymbols?.length || 0, "symbol")}`,
        `direct callers: ${formatCount(impact.directCallers?.length || 0, "node")}`,
        `direct callees: ${formatCount(impact.directCallees?.length || 0, "node")}`,
        `impacted files: ${formatCount(impact.impactedFiles?.length || 0, "file")}`,
        ""
      ];

      if (impact.directCallers?.length) {
        lines.push("callers:");
        for (const item of impact.directCallers.slice(0, 12)) {
          lines.push(`  <- ${item.qualifiedName || item.name || "unknown"} :: ${item.filePath}`);
        }
      }

      if (impact.directCallees?.length) {
        lines.push("");
        lines.push("callees:");
        for (const item of impact.directCallees.slice(0, 12)) {
          lines.push(`  -> ${item.qualifiedName || item.name || "unknown"} :: ${item.filePath}`);
        }
      }

      if (impact.impactedFiles?.length) {
        lines.push("");
        lines.push("impacted files:");
        for (const filePath of impact.impactedFiles.slice(0, 20)) {
          lines.push(`  * ${filePath}`);
        }
      }

      push({
        type: "block",
        level: "action",
        tag: "ACTION",
        view: "impact",
        data: impact,
        text: lines.join("\n")
      });
      return { ok: true, command, view: "impact", data: impact, events };
    }

    case "target": {
      const nextPath = path.resolve(argText || "");
      if (!argText) {
        push({
          type: "line",
          level: "bad",
          tag: "ERR",
          view: "target",
          text: "target requires a repo or file path"
        });
        return { ok: false, command, view: "target", error: "missing_target_path", events };
      }

      let descriptor;
      try {
        descriptor = await normalizeTargetDescriptor(nextPath);
      } catch {
        push({
          type: "line",
          level: "bad",
          tag: "ERR",
          view: "target",
          text: `target not found: ${nextPath}`
        });
        return { ok: false, command, view: "target", error: "target_not_found", events };
      }

      currentTarget = descriptor;
      latestState = null;
      startupIndexError = null;
      await writeRuntime({ indexing: true }, currentTarget);
      void startIndexing(currentTarget.path, currentTarget.storageRoot);
      push({
        type: "line",
        level: "warn",
        tag: "WARN",
        view: "target",
        data: {
          targetPath: currentTarget.path,
          storageRoot: currentTarget.storageRoot
        },
        text: `target accepted: ${currentTarget.path}`
      });
      push({
        type: "line",
        level: "action",
        tag: "ACTION",
        view: "target",
        data: {
          targetPath: currentTarget.path,
          storageRoot: currentTarget.storageRoot
        },
        text: "indexing started"
      });
      return {
        ok: true,
        command,
        view: "target",
        data: {
          targetPath: currentTarget.path,
          storageRoot: currentTarget.storageRoot
        },
        events
      };
    }

    case "refresh": {
      await waitForIndexing();
      const state = await refreshIndex(currentTarget.path, { storageRoot: currentTarget.storageRoot });
      latestState = state;
      startupIndexError = null;
      await writeRuntime({
        indexing: false,
        indexedAt: new Date().toISOString(),
        summary: state.summary,
        indexError: null
      }, currentTarget);
      push({
        type: "line",
        level: "ok",
        tag: "OK",
        view: "status",
        data: state.summary,
        text: `re-indexed ${state.summary.fileCount} files | ${state.summary.symbolCount} symbols | ${state.summary.edgeCount} edges`
      });
      return { ok: true, command, view: "status", data: state.summary, events };
    }

    case "clear": {
      const cleared = broadcastClear(clientId);
      return { ok: true, command, view: "clear", data: { cleared: true }, events: [cleared] };
    }

    default: {
      push({
        type: "line",
        level: "bad",
        tag: "ERR",
        view: "help",
        text: `unknown command: ${name}`
      });
      return { ok: false, command, view: "help", error: "unknown_command", events };
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

function parseNameFromPath(urlPath, prefix) {
  const raw = decodeURIComponent(urlPath.slice(prefix.length));
  return raw.replace(/^\/+/, "");
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function readPublicAsset(fileName) {
  return fs.readFile(path.join(publicDir, fileName), "utf8");
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const { pathname, searchParams } = requestUrl;

  if (pathname === "/" || pathname === "/index.html") {
    const html = await readPublicAsset("index.html");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(html);
    return;
  }

  if (pathname === "/app.js") {
    const script = await readPublicAsset("app.js");
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(script);
    return;
  }

  if (pathname === "/styles.css") {
    const css = await readPublicAsset("styles.css");
    res.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(css);
    return;
  }

  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "api" });
    return;
  }

  if (pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });
    res.write("\n");
    eventClients.add(res);

    for (const event of recentEvents) {
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    req.on("close", () => {
      eventClients.delete(res);
    });
    return;
  }

  if (pathname === "/refresh") {
    await waitForIndexing();
    console.log(`[symapse] refreshing index ${currentTarget.path}`);
    const state = await refreshIndex(currentTarget.path, { storageRoot: currentTarget.storageRoot });
    latestState = state;
    startupIndexError = null;
    await writeRuntime({
      indexing: false,
      indexedAt: new Date().toISOString(),
      summary: state.summary,
      indexError: null,
    }, currentTarget);
    sendJson(res, 200, { ok: true, summary: state.summary });
    return;
  }

  if (pathname === "/status") {
    if (startupIndexError) {
      sendJson(res, 200, createFallbackStatus());
      return;
    }

    if (!latestState) {
      sendJson(res, 200, createFallbackStatus());
      return;
    }

    const status = await getStatus(currentTarget.storageRoot);
    sendJson(res, 200, {
      ...status,
      indexing: false,
      indexError: null,
      targetPath: currentTarget.path,
      storageRoot: currentTarget.storageRoot
    });
    return;
  }

  if (pathname === "/tree") {
    const tree = await getRepoTree(currentTarget.path);
    sendJson(res, 200, tree);
    return;
  }

  if (pathname === "/changes") {
    const changes = await getChanges(currentTarget.storageRoot);
    sendJson(res, 200, {
      repoRoot: currentTarget.path,
      storageRoot: currentTarget.storageRoot,
      changes
    });
    return;
  }

  if (pathname === "/deadcode") {
    await waitForIndexing();
    const limit = Number(searchParams.get("limit") || 30);
    const result = await getDeadCodeCandidates(currentTarget.storageRoot, limit);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/target" && req.method === "GET") {
    sendJson(res, 200, {
      targetPath: currentTarget.path,
      storageRoot: currentTarget.storageRoot,
      indexing: Boolean(startupIndexPromise) && !latestState && !startupIndexError,
      indexError: startupIndexError,
      latestState: Boolean(latestState)
    });
    return;
  }

  if (pathname === "/target" && req.method === "POST") {
    const body = await readJsonBody(req);
    const nextPath = path.resolve(body.path || "");

    if (!body.path) {
      sendJson(res, 400, { error: "missing_target_path" });
      return;
    }

    let descriptor;
    try {
      descriptor = await normalizeTargetDescriptor(nextPath);
    } catch {
      sendJson(res, 404, { error: "target_not_found", path: nextPath });
      return;
    }

    currentTarget = descriptor;
    latestState = null;
    startupIndexError = null;
    await writeRuntime({
      indexing: true,
    }, currentTarget);
    const state = await startIndexing(currentTarget.path, currentTarget.storageRoot);
    sendJson(res, 200, {
      ok: true,
      targetPath: currentTarget.path,
      storageRoot: currentTarget.storageRoot,
      summary: state?.summary ?? createEmptySummary(),
      indexError: startupIndexError
    });
    return;
  }

  if (pathname === "/architecture") {
    await waitForIndexing();
    const result = await getArchitectureSummary(currentTarget.storageRoot);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/featureplan") {
    await waitForIndexing();
    const query = searchParams.get("q") ?? "";
    const result = await planFeature(currentTarget.storageRoot, query);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/overlap") {
    await waitForIndexing();
    const limit = Number(searchParams.get("limit") || 20);
    const minScore = Number(searchParams.get("minScore") || 15);
    const result = await findSemanticOverlaps(currentTarget.storageRoot, limit, minScore);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/where") {
    await waitForIndexing();
    const query = searchParams.get("q") ?? "";
    const limit = Number(searchParams.get("limit") || 5);
    const result = await findWhereToIntegrate(currentTarget.storageRoot, query, limit);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/architecture") {
    await waitForIndexing();
    const result = await getArchitectureSummary(currentTarget.storageRoot);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/dashboard/efficiency") {
    await waitForIndexing();
    const state = await ensureState(currentTarget.storageRoot);
    const sessions = await querySessionSignals(currentTarget.storageRoot);
    const knowledge = await queryKnowledge(currentTarget.storageRoot, null);
    const toolCounts = {};
    for (const s of sessions) { toolCounts[s.action_type] = (toolCounts[s.action_type] || 0) + 1; }
    const topTools = Object.entries(toolCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const totalTokens = sessions.length * 400;
    const totalCost = (totalTokens / 1000 * 0.003).toFixed(2);
    sendJson(res, 200, { totalTokens, savedTokens: totalTokens * 2, toolCounts: topTools, sessionCount: new Set(sessions.map(s => s.session_id)).size, knowledgeEntries: knowledge.length });
    return;
  }

  if (pathname === "/dashboard/sessions") {
    await waitForIndexing();
    const signals = await querySessionSignals(currentTarget.storageRoot);
    const grouped = new Map();
    for (const s of signals) {
      const bucket = grouped.get(s.session_id) ?? { sessionId: s.session_id, actions: [], toolCalls: 0, warnings: [] };
      if (s.action_type === "queried") bucket.actions.push({ tool: "symapse_impact", target: s.symbol_or_file, time: s.timestamp });
      bucket.toolCalls++;
      grouped.set(s.session_id, bucket);
    }
    const sessions = [...grouped.values()].sort((a,b) => b.toolCalls - a.toolCalls).slice(0, 10);
    sendJson(res, 200, { sessions });
    return;
  }

  if (pathname === "/dashboard/findings") {
    await waitForIndexing();
    const knowledge = await queryKnowledge(currentTarget.storageRoot, "finding");
    const patterns = await queryKnowledge(currentTarget.storageRoot, "workflow_symbols");
    sendJson(res, 200, { findings: knowledge, patterns, total: knowledge.length + patterns.length });
    return;
  }

  if (pathname === "/dashboard/memory") {
    await waitForIndexing();
    const all = await queryKnowledge(currentTarget.storageRoot, null);
    const byType = {};
    for (const k of all) { const b = byType[k.type] ?? []; b.push({ key: k.key, value: k.value, timestamp: k.timestamp }); byType[k.type] = b; }
    sendJson(res, 200, { byType, total: all.length });
    return;
  }

  if (pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    try {
      const htmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dashboard.html");
      const html = await fs.readFile(htmlPath, "utf8");
      res.end(html);
    } catch { res.end("Dashboard not found"); }
    return;
  }

  if (pathname === "/command" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await executeCommand(body.command || "", {
      clientId: body.clientId || null
    });
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (pathname === "/changed") {
    await waitForIndexing();
    const state = await ensureState(currentTarget.storageRoot);
    sendJson(res, 200, {
      changedFunctions: state.changedFunctions,
      removedFunctions: state.removedFunctions,
      summary: state.summary
    });
    return;
  }

  if (pathname === "/search") {
    await waitForIndexing();
    const query = searchParams.get("q") ?? "";
    const functions = await listFunctions(currentTarget.storageRoot, query);
    sendJson(res, 200, { query, functions });
    return;
  }

  if (pathname.startsWith("/function/")) {
    await waitForIndexing();
    const name = parseNameFromPath(pathname, "/function/");
    const matches = await getFunctionMatches(currentTarget.storageRoot, name);
    sendJson(res, 200, {
      query: name,
      matches
    });
    return;
  }

  if (pathname.startsWith("/impact/")) {
    await waitForIndexing();
    const name = parseNameFromPath(pathname, "/impact/");
    const impact = await getImpact(currentTarget.storageRoot, name);

    if (!impact) {
      sendJson(res, 404, { error: "function_not_found", query: name });
      return;
    }

    sendJson(res, 200, impact);
    return;
  }

  notFound(res);
}

async function main() {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      sendJson(res, 500, {
        error: "internal_error",
        message: error?.message ?? "Unknown error"
      });
    });
  });

  const initialDescriptor = await normalizeTargetDescriptor(initialTargetPath);
  currentTarget = initialDescriptor;
  runtimePort = await listenWithFallback(server, preferredPort);
  runtimeBase = `http://localhost:${runtimePort}`;
  void startIndexing(initialDescriptor.path, initialDescriptor.storageRoot);
  await writeRuntime({
    indexing: true,
  }, initialDescriptor);
  console.log(`@symapse/api listening on http://localhost:${runtimePort}`);
}

async function listenWithFallback(server, startPort, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("error", onError);
          reject(error);
        };

        server.once("error", onError);
        server.listen(port, () => {
          server.off("error", onError);
          resolve();
        });
      });

      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE" && error?.code !== "EACCES") {
        throw error;
      }
    }
  }

  throw new Error(`Unable to find a free API port starting at ${startPort}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
