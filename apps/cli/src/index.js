#!/usr/bin/env node
import path from "node:path";
import { clarifyRequest, findSemanticOverlaps, findWhereToIntegrate, getArchitectureSummary, getContextFiles, getConventions, getDeadCodeCandidates, getImpact, getStatus, listFunctions, refreshIndex } from "../../../packages/engine/src/index.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(process.env.SYMAPSE_REPO_ROOT || process.cwd());
const command = process.argv[2] ?? "help";
const target = process.argv[3] ?? "";

async function refreshWithProgress(root, label = "indexing") {
  const frames = ["|", "/", "-", "\\"];
  let frame = 0;
  let active = true;
  process.stdout.write(`[symapse] ${label} ${frames[frame]}`);
  const timer = setInterval(() => {
    if (!active) {
      return;
    }

    frame = (frame + 1) % frames.length;
    process.stdout.write(`\r[symapse] ${label} ${frames[frame]}`);
  }, 120);

  try {
    return await refreshIndex(root);
  } finally {
    active = false;
    clearInterval(timer);
    process.stdout.write(`\r[symapse] ${label} done\n`);
  }
}

function printHelp() {
  console.log("Symapse CLI");
  console.log("");
  console.log("Commands:");
  console.log("  mcp [repo]       Start MCP server for the given repo");
  console.log("  index [repo]     Index the repository");
  console.log("  clarify <desc>   Analyze request for ambiguity");
  console.log("  impact <name>    Show callers, callees, and impacted files");
  console.log("  search <query>   Search symbols");
  console.log("  deadcode [n]     Show top N dead code candidates");
  console.log("  overlap [n]      Find semantically similar functions");
  console.log("  where <desc>     Find the best module for new code");
  console.log("  context <desc>   Identify must-read files for a feature");
  console.log("  architecture     Print domain map and critical modules");
  console.log("  conventions      Show per-module naming/coding conventions");
  console.log("  changed          Print recent changes");
  console.log("  status           Show index stats");
}

async function run() {
  if (command === "mcp") {
    const mcpTarget = target ? path.resolve(process.cwd(), target) : repoRoot;
    const mcpPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/mcp/src/index.js");
    const child = spawn("node", [fileURLToPath(new URL("../../../packages/mcp/src/index.js", import.meta.url))], { stdio: "inherit", env: { ...process.env, SYMAPSE_REPO_ROOT: mcpTarget } });
    child.on("exit", (code) => process.exit(code || 0));
    return;
  }

  if (command === "index") {
    const root = target ? path.resolve(process.cwd(), target) : repoRoot;
    console.log(`[symapse] indexing repo ${root}`);
    const state = await refreshWithProgress(root, "indexing repo");
    const inc = state.summary.incrementalParsed !== undefined
      ? ` (${state.summary.incrementalParsed} changed, ${state.summary.incrementalSkipped} skipped)`
      : "";
    console.log(
      `[symapse] indexed ${state.summary.fileCount} files${inc} | ${state.summary.symbolCount} symbols | ${state.summary.edgeCount} edges`
    );
    console.log(JSON.stringify(state.summary, null, 2));
    return;
  }

  if (command === "changed") {
    const status = await getStatus(repoRoot);
    console.log(JSON.stringify({
      summary: status.summary,
      recentChanges: status.recentChanges,
      removedFunctions: status.removedFunctions
    }, null, 2));
    return;
  }

  if (command === "impact") {
    if (!target) {
      printHelp();
      process.exitCode = 1;
      return;
    }

    const impact = await getImpact(repoRoot, target);
    if (!impact) {
      console.log(JSON.stringify({ error: "function_not_found", query: target }, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(impact, null, 2));
    return;
  }

  if (command === "search") {
    const results = await listFunctions(repoRoot, target);
    console.log(JSON.stringify({ query: target, functions: results }, null, 2));
    return;
  }

  if (command === "deadcode") {
    const limit = Number(target || 30);
    const result = await getDeadCodeCandidates(repoRoot, limit);
    console.log(JSON.stringify({
      totalExamined: result.totalSymbolsExamined,
      totalCandidates: result.totalCandidates,
      candidates: result.candidates
    }, null, 2));
    return;
  }

  if (command === "overlap") {
    const limit = Number(target || 20);
    const result = await findSemanticOverlaps(repoRoot, limit, 15);
    console.log(JSON.stringify({
      totalPairs: result.totalPairs,
      overlaps: result.overlaps
    }, null, 2));
    return;
  }

  if (command === "architecture") {
    const result = await getArchitectureSummary(repoRoot);
    console.log(JSON.stringify({
      domains: result.domains,
      criticalModules: result.criticalModules,
      hubFunctions: result.hubFunctions,
      entryPoints: result.entryPoints,
      summary: result.summary
    }, null, 2));
    return;
  }

  if (command === "where") {
    const query = target || process.argv.slice(3).join(" ");
    const result = await findWhereToIntegrate(repoRoot, query);
    console.log(JSON.stringify({
      query: result.query,
      candidates: result.candidates,
      relatedSymbols: result.relatedSymbols
    }, null, 2));
    return;
  }

  if (command === "clarify") {
    const query = target || process.argv.slice(3).join(" ");
    const result = await clarifyRequest(repoRoot, query);
    console.log(JSON.stringify({
      request: result.request,
      confidence: result.confidence,
      action: result.action,
      missingDecisions: result.missingDecisions,
      relatedSystems: result.relatedSystems,
      architecturalTargets: result.architecturalTargets,
      questions: result.questions
    }, null, 2));
    return;
  }

  if (command === "context") {
    const query = target || process.argv.slice(3).join(" ");
    const result = await getContextFiles(repoRoot, query);
    console.log(JSON.stringify({
      query: result.query,
      contextualLimit: result.contextualLimit,
      repoFiles: result.fileCount,
      files: result.files
    }, null, 2));
    return;
  }

  if (command === "conventions") {
    const result = await getConventions(repoRoot);
    console.log(JSON.stringify({
      domains: result.domains,
      summary: result.summary
    }, null, 2));
    return;
  }

  if (command === "status") {
    const status = await getStatus(repoRoot);
    console.log(JSON.stringify({
      summary: status.summary,
      topFiles: status.topFiles
    }, null, 2));
    return;
  }

  printHelp();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
