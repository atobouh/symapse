import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const children = [];
const selectedRepoRoot = resolveSelectedRepoRoot(process.argv.slice(2));
const runtimePath = path.join(selectedRepoRoot, ".symapse", "runtime.json");

function resolveSelectedRepoRoot(args) {
  if (!args.length) {
    return root;
  }

  if (args[0] === "--repo" || args[0] === "-r") {
    return path.resolve(root, args[1] || root);
  }

  if (args[0].startsWith("-")) {
    return root;
  }

  return path.resolve(root, args[0]);
}

function prefix(name, data) {
  const text = data.toString("utf8").trimEnd();
  if (!text) {
    return;
  }

  for (const line of text.split("\n")) {
    process.stdout.write(`[${name}] ${line}\n`);
  }
}

function createSpinner(message) {
  const frames = ["|", "/", "-", "\\"];
  let frame = 0;
  let active = true;

  process.stdout.write(`[symapse] ${message} ${frames[frame]}`);
  const timer = setInterval(() => {
    if (!active) {
      return;
    }

    frame = (frame + 1) % frames.length;
    process.stdout.write(`\r[symapse] ${message} ${frames[frame]}`);
  }, 120);

  return () => {
    if (!active) {
      return;
    }

    active = false;
    clearInterval(timer);
    process.stdout.write(`\r[symapse] ${message} done\n`);
  };
}

function start(name, filePath, env = {}) {
  const child = spawn(process.execPath, [filePath], {
    cwd: root,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => prefix(name, chunk));
  child.stderr.on("data", (chunk) => prefix(name, chunk));
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

async function waitForRuntimeInfo(timeoutMs = 15000, predicate = (value) => Boolean(value?.apiBase)) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fs.readFile(runtimePath, "utf8");
      const parsed = JSON.parse(raw);
      if (predicate(parsed)) {
        return parsed;
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for ${runtimePath}`);
}

async function openBrowser(url) {
  if (process.env.SYMAPSE_NO_OPEN === "1") {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore"
      });
      child.on("error", reject);
      child.on("exit", () => resolve());
      child.unref();
    });
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise((resolve, reject) => {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("exit", () => resolve());
    child.unref();
  });
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

async function main() {
  const sessionStartedAt = Date.now();
  const repoEnv = {
    SYMAPSE_REPO_ROOT: selectedRepoRoot,
    SYMAPSE_OPEN_BROWSER: "0"
  };

  await fs.access(selectedRepoRoot);
  console.log(`[symapse] repo: ${selectedRepoRoot}`);
  start("api", path.join(root, "apps", "api", "src", "index.js"), repoEnv);
  const stopApiSpinner = createSpinner("indexing repo");
  let apiRuntime;
  try {
    apiRuntime = await waitForRuntimeInfo(15000, (value) => {
      const updatedAt = value?.updatedAt ? Date.parse(value.updatedAt) : NaN;
      return Boolean(value?.apiBase) && Number.isFinite(updatedAt) && updatedAt >= sessionStartedAt;
    });
  } finally {
    stopApiSpinner();
  }
  start("web", path.join(root, "apps", "web", "src", "index.js"), {
    ...repoEnv,
    SYMAPSE_API_BASE: apiRuntime.apiBase
  });
  const webRuntime = await waitForRuntimeInfo(15000, (value) => {
    const updatedAt = value?.updatedAt ? Date.parse(value.updatedAt) : NaN;
    return Boolean(value?.webBase) && Number.isFinite(updatedAt) && updatedAt >= sessionStartedAt;
  });
  console.log(`[symapse] api: ${apiRuntime.apiBase}`);
  console.log(`[symapse] web: ${webRuntime.webBase}`);
  const browserPromise = openBrowser(webRuntime.webBase);

  if (apiRuntime.indexing !== false && !apiRuntime.indexError) {
    const stopIndexSpinner = createSpinner("indexing repo");
    try {
      await waitForRuntimeInfo(30 * 60 * 1000, (value) => value?.indexing === false || Boolean(value?.indexError));
    } finally {
      stopIndexSpinner();
    }
  }

  await browserPromise;
}

void main().catch((error) => {
  console.error(error);
  shutdown(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
