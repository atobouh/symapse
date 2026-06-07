import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeInfo, writeRuntimeInfo } from "../../../packages/db/src/store.js";

const preferredPort = Number(process.env.PORT || 3580);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = path.join(rootDir, "public");
const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const repoRoot = path.resolve(process.env.SYMAPSE_REPO_ROOT || defaultRepoRoot);
const apiBase = process.env.SYMAPSE_API_BASE || "http://localhost:4580";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

async function readPublicFile(fileName) {
  return fs.readFile(path.join(publicDir, fileName), "utf8");
}

async function serve(req, res) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname = requestUrl.pathname;

  if (pathname === "/" || pathname === "/index.html") {
    const runtime = await readRuntimeInfo(repoRoot);
    const effectiveApiBase = runtime?.apiBase ?? apiBase;
    const html = (await readPublicFile("index.html")).replaceAll("__SYMAPSE_API_BASE__", effectiveApiBase);
    res.writeHead(200, { "content-type": contentTypes[".html"] });
    res.end(html);
    return;
  }

  if (pathname === "/app.js") {
    const script = await readPublicFile("app.js");
    res.writeHead(200, { "content-type": contentTypes[".js"] });
    res.end(script);
    return;
  }

  if (pathname === "/styles.css") {
    const css = await readPublicFile("styles.css");
    res.writeHead(200, { "content-type": contentTypes[".css"] });
    res.end(css);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
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

  throw new Error(`Unable to find a free port starting at ${startPort}`);
}

const server = http.createServer((req, res) => {
  void serve(req, res).catch((error) => {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error?.message ?? "Unknown error");
  });
});

listenWithFallback(server, preferredPort)
  .then(async (port) => {
    const runtime = await readRuntimeInfo(repoRoot);
    await writeRuntimeInfo(repoRoot, {
      ...(runtime || {}),
      repoRoot,
      apiBase: runtime?.apiBase || apiBase,
      webBase: `http://localhost:${port}`,
      webPort: port,
      updatedAt: new Date().toISOString()
    });
    return port;
  })
  .then((port) => {
    console.log(`@symapse/web listening on http://localhost:${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
